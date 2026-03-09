import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { vercelToken, vercelProject, cfAccountId, cfToken, cfProject, env } =
    await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: string, type: "info" | "ok" | "err" = "info") => {
        controller.enqueue(
          encoder.encode(JSON.stringify({ msg, type }) + "\n")
        );
      };

      try {
        // 1. Pull from Vercel
        send(`Pulling env vars from Vercel (${vercelProject}, ${env})...`);

        const vRes = await fetch(
          `https://api.vercel.com/v9/projects/${vercelProject}/env`,
          { headers: { Authorization: `Bearer ${vercelToken}` } }
        );

        if (!vRes.ok) {
          send(`Vercel API error ${vRes.status}: ${await vRes.text()}`, "err");
          controller.close();
          return;
        }

        const { envs } = await vRes.json();
        const vars = envs.filter(
          (e: { target: string[]; type: string }) =>
            e.target.includes(env) && e.type !== "system"
        );

        send(`Found ${vars.length} env vars`, "ok");

        if (vars.length === 0) {
          send("Nothing to migrate.", "err");
          controller.close();
          return;
        }

        // List them
        for (const v of vars) {
          send(`  ${v.key} (${v.type})`);
        }

        // 2. Push each var as a Worker secret via Cloudflare API
        send(`\nPushing to Cloudflare Worker (${cfProject})...`);

        let success = 0;
        let failed = 0;

        for (const v of vars) {
          const value = v.value || "";
          if (!value) {
            send(`  ⚠ ${v.key}: empty value (Vercel may not decrypt), skipping`, "err");
            failed++;
            continue;
          }

          // Use the Workers secrets API (PUT)
          const cfRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/workers/scripts/${cfProject}/secrets`,
            {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${cfToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: v.key,
                text: value,
                type: "secret_text",
              }),
            }
          );

          const cfData = await cfRes.json();

          if (cfData.success) {
            send(`  ✓ ${v.key}`, "ok");
            success++;
          } else {
            const errMsg = cfData.errors?.[0]?.message || JSON.stringify(cfData.errors);
            send(`  ✗ ${v.key}: ${errMsg}`, "err");
            failed++;
          }
        }

        send(
          `\nDone! ${success} migrated, ${failed} failed.`,
          failed === 0 ? "ok" : "err"
        );
      } catch (e) {
        send(`Error: ${(e as Error).message}`, "err");
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

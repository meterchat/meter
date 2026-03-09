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

        // 2. Build Cloudflare format
        const cfVars: Record<
          string,
          { type: string; value: string }
        > = {};
        for (const v of vars) {
          cfVars[v.key] = { type: "secret_text", value: v.value || "" };
        }

        // 3. Push to Cloudflare
        const cfKey = env === "production" ? "production" : "preview";
        send(`\nPushing to Cloudflare Pages (${cfProject}, ${cfKey})...`);

        const cfRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/pages/projects/${cfProject}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${cfToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              deployment_configs: { [cfKey]: { env_vars: cfVars } },
            }),
          }
        );

        const cfData = await cfRes.json();

        if (cfData.success) {
          send(
            `\nDone! ${vars.length} env vars migrated to Cloudflare Pages.`,
            "ok"
          );
        } else {
          send(`Cloudflare error:`, "err");
          send(JSON.stringify(cfData.errors, null, 2), "err");
        }
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

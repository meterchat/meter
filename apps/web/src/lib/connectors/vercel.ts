async function vercelFetch(url: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Vercel API error (${res.status}): ${text}`);
  }
  return res.json();
}

export async function listDeployments(accessToken: string, project: string, limit = 10) {
  const url = new URL("https://api.vercel.com/v6/deployments");
  url.searchParams.set("projectIdOrName", project);
  url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 20))));
  const data = await vercelFetch(url.toString(), accessToken);
  const deployments = (data.deployments ?? []).map((d: Record<string, unknown>) => ({
    id: d.uid ?? d.id,
    name: d.name,
    url: d.url ? `https://${d.url}` : null,
    state: d.state,
    createdAt: d.createdAt,
  }));
  return { deployments };
}

export async function triggerDeployment(accessToken: string, project: string) {
  const projectData = await vercelFetch(`https://api.vercel.com/v9/projects/${project}`, accessToken);
  const link = projectData.link as { type?: string; repoId?: number | string; productionBranch?: string; gitBranch?: string } | null;
  if (!link?.type || !link.repoId) {
    throw new Error("Project is not linked to a Git repository.");
  }

  const ref = link.productionBranch ?? link.gitBranch ?? "main";
  const deployBody = {
    name: projectData.name,
    project: projectData.id ?? projectData.name,
    gitSource: {
      type: link.type,
      repoId: link.repoId,
      ref,
    },
  };

  const deployUrl = new URL("https://api.vercel.com/v13/deployments");
  if (projectData.teamId) {
    deployUrl.searchParams.set("teamId", projectData.teamId);
  }

  const deployment = await vercelFetch(deployUrl.toString(), accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deployBody),
  });

  return {
    id: deployment.id ?? deployment.uid,
    url: deployment.url ? `https://${deployment.url}` : null,
    state: deployment.state,
  };
}

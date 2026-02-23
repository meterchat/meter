async function githubFetch(url: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`GitHub API error (${res.status}): ${text}`);
  }
  return res.json();
}

/** Like githubFetch but returns null on 404 instead of throwing. */
async function githubFetchOptional(url: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`GitHub API error (${res.status}): ${text}`);
  }
  return res.json();
}

export async function listRepos(accessToken: string, limit = 20) {
  const url = new URL("https://api.github.com/user/repos");
  url.searchParams.set("per_page", String(Math.max(1, Math.min(limit, 50))));
  url.searchParams.set("sort", "updated");
  const data = await githubFetch(url.toString(), accessToken);
  const repos = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    url: r.html_url,
    description: r.description,
    updatedAt: r.updated_at,
  }));
  return { repos };
}

export async function createRepo(accessToken: string, params: { name: string; description?: string; private?: boolean }) {
  const body = {
    name: params.name,
    description: params.description ?? "",
    private: params.private ?? false,
  };
  const data = await githubFetch("https://api.github.com/user/repos", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    id: data.id,
    name: data.name,
    fullName: data.full_name,
    url: data.html_url,
  };
}

export async function createIssue(accessToken: string, params: { repo: string; title: string; body?: string }) {
  const [owner, name] = params.repo.split("/");
  if (!owner || !name) {
    throw new Error("Repo must be in owner/name format.");
  }
  const body = {
    title: params.title,
    body: params.body ?? "",
  };
  const data = await githubFetch(`https://api.github.com/repos/${owner}/${name}/issues`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    id: data.id,
    number: data.number,
    url: data.html_url,
    title: data.title,
  };
}

export async function getFileContent(
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  branch?: string,
): Promise<{ content: string; sha: string } | null> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`);
  if (branch) url.searchParams.set("ref", branch);
  const data = await githubFetchOptional(url.toString(), accessToken);
  if (!data) return null;
  // GitHub returns base64-encoded content
  const content = Buffer.from(data.content as string, "base64").toString("utf-8");
  return { content, sha: data.sha as string };
}

export async function createOrUpdateFile(
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch?: string,
  sha?: string,
): Promise<{ sha: string; url: string }> {
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
  };
  if (branch) body.branch = branch;
  if (sha) body.sha = sha;

  const data = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    accessToken,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return {
    sha: data.content?.sha as string,
    url: data.content?.html_url as string,
  };
}

"use client";

import { useState, useRef } from "react";

interface LogEntry {
  msg: string;
  type: "info" | "ok" | "err";
}

export default function MigratePage() {
  const [vercelToken, setVercelToken] = useState("");
  const [vercelProject, setVercelProject] = useState("meter");
  const [cfAccountId, setCfAccountId] = useState("");
  const [cfToken, setCfToken] = useState("");
  const [cfProject, setCfProject] = useState("meter");
  const [env, setEnv] = useState("production");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  async function migrate() {
    if (!vercelToken || !cfAccountId || !cfToken) return;
    setLogs([]);
    setRunning(true);

    try {
      const res = await fetch("/api/migrate-env", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vercelToken,
          vercelProject,
          cfAccountId,
          cfToken,
          cfProject,
          env,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const entry = JSON.parse(line) as LogEntry;
          setLogs((prev) => [...prev, entry]);
          logRef.current?.scrollTo(0, logRef.current.scrollHeight);
        }
      }
    } catch (e) {
      setLogs((prev) => [
        ...prev,
        { msg: `Network error: ${(e as Error).message}`, type: "err" },
      ]);
    }
    setRunning(false);
  }

  const colorMap = { ok: "text-green-400", err: "text-red-400", info: "text-neutral-400" };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-xl p-8">
        <h1 className="text-lg font-semibold text-white">Migrate Env Vars</h1>
        <p className="text-neutral-500 text-sm mb-6">
          Vercel → Cloudflare Pages
        </p>

        <Label>Vercel Token</Label>
        <Input
          type="password"
          placeholder="from vercel.com/account/tokens"
          value={vercelToken}
          onChange={(e) => setVercelToken(e.target.value)}
        />

        <Label>Vercel Project Name</Label>
        <Input
          placeholder="meter"
          value={vercelProject}
          onChange={(e) => setVercelProject(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>CF Account ID</Label>
            <Input
              type="password"
              placeholder="from dashboard URL"
              value={cfAccountId}
              onChange={(e) => setCfAccountId(e.target.value)}
            />
          </div>
          <div>
            <Label>CF API Token</Label>
            <Input
              type="password"
              placeholder="Workers template"
              value={cfToken}
              onChange={(e) => setCfToken(e.target.value)}
            />
          </div>
        </div>

        <Label>CF Pages Project</Label>
        <Input
          placeholder="meter"
          value={cfProject}
          onChange={(e) => setCfProject(e.target.value)}
        />

        <Label>Environment</Label>
        <select
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          className="w-full px-3 py-2 bg-black border border-neutral-800 rounded-md text-white text-sm"
        >
          <option value="production">Production</option>
          <option value="preview">Preview</option>
        </select>

        <button
          onClick={migrate}
          disabled={running || !vercelToken || !cfAccountId || !cfToken}
          className="w-full mt-6 py-2.5 bg-white text-black rounded-md text-sm font-semibold hover:bg-neutral-200 disabled:bg-neutral-700 disabled:text-neutral-400 disabled:cursor-not-allowed transition-colors"
        >
          {running ? "Migrating..." : "Migrate Environment Variables"}
        </button>

        {logs.length > 0 && (
          <div
            ref={logRef}
            className="mt-4 font-mono text-xs leading-relaxed max-h-64 overflow-y-auto"
          >
            {logs.map((l, i) => (
              <div key={i} className={colorMap[l.type]}>
                {l.msg}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs text-neutral-400 mt-4 mb-1">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full px-3 py-2 bg-black border border-neutral-800 rounded-md text-white text-sm font-mono placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600"
    />
  );
}

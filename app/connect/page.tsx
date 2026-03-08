import Link from 'next/link'

export default function ConnectPage() {
  return (
    <div className="min-h-screen bg-[#1a1a1a] text-[#e5e5e5]">
      <div className="max-w-2xl mx-auto px-6 py-16">
        {/* Header */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-[#666] hover:text-[#999] transition-colors mb-12"
        >
          ← Back to Meter
        </Link>

        <h1 className="text-2xl font-medium mb-2">Connect Meter</h1>
        <p className="text-[#999] text-sm mb-12">
          Pipe your decisions and documents into any tool via MCP.
        </p>

        {/* What you get */}
        <section className="mb-12">
          <h2 className="text-sm font-medium text-[#e5e5e5] mb-4">
            What your tools can access
          </h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-sm">
              <span className="text-[#666] font-mono text-xs mt-0.5 shrink-0 w-24">decisions</span>
              <span className="text-[#999]">
                Every locked decision with context, reasoning, and metadata.
              </span>
            </div>
            <div className="flex items-start gap-3 text-sm">
              <span className="text-[#666] font-mono text-xs mt-0.5 shrink-0 w-24">documents</span>
              <span className="text-[#999]">
                Blueprints, specs, and documents generated in your workspace.
              </span>
            </div>
            <div className="flex items-start gap-3 text-sm">
              <span className="text-[#666] font-mono text-xs mt-0.5 shrink-0 w-24">context</span>
              <span className="text-[#999]">
                Workspace-level context so external tools understand your project.
              </span>
            </div>
          </div>
        </section>

        {/* Setup */}
        <section className="mb-12">
          <h2 className="text-sm font-medium text-[#e5e5e5] mb-4">
            Setup
          </h2>
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-[#666] bg-[#222] px-1.5 py-0.5 rounded">1</span>
                <span className="text-sm">Generate an API key</span>
              </div>
              <p className="text-xs text-[#999] ml-7">
                Open any workspace → Inspector → Settings → Generate API Key
              </p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-[#666] bg-[#222] px-1.5 py-0.5 rounded">2</span>
                <span className="text-sm">Add the MCP server to your tool</span>
              </div>
              <div className="ml-7 mt-3 space-y-4">
                {/* Claude Code */}
                <div>
                  <p className="text-xs font-medium text-[#999] mb-2">Claude Code</p>
                  <pre className="text-xs font-mono bg-[#111] border border-[#333] rounded-lg p-4 overflow-x-auto">
                    <code>{`claude mcp add meter \\
  --transport sse \\
  --url https://meter.chat/api/mcp \\
  --header "Authorization: Bearer YOUR_API_KEY"`}</code>
                  </pre>
                </div>

                {/* Cursor */}
                <div>
                  <p className="text-xs font-medium text-[#999] mb-2">Cursor</p>
                  <p className="text-xs text-[#999] mb-2">
                    Add to <code className="text-[#666] bg-[#222] px-1 py-0.5 rounded">.cursor/mcp.json</code>
                  </p>
                  <pre className="text-xs font-mono bg-[#111] border border-[#333] rounded-lg p-4 overflow-x-auto">
                    <code>{`{
  "mcpServers": {
    "meter": {
      "transport": "sse",
      "url": "https://meter.chat/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}</code>
                  </pre>
                </div>

                {/* Generic */}
                <div>
                  <p className="text-xs font-medium text-[#999] mb-2">Any MCP client</p>
                  <pre className="text-xs font-mono bg-[#111] border border-[#333] rounded-lg p-4 overflow-x-auto">
                    <code>{`Server URL: https://meter.chat/api/mcp
Transport:  SSE
Auth:       Bearer YOUR_API_KEY`}</code>
                  </pre>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-[#666] bg-[#222] px-1.5 py-0.5 rounded">3</span>
                <span className="text-sm">Use it</span>
              </div>
              <p className="text-xs text-[#999] ml-7">
                Your coding tool can now read your Meter decisions and documents. 
                Ask it to check your decisions before making architectural choices,
                or reference your blueprints when generating code.
              </p>
            </div>
          </div>
        </section>

        {/* Available tools */}
        <section className="mb-12">
          <h2 className="text-sm font-medium text-[#e5e5e5] mb-4">
            Available MCP tools
          </h2>
          <div className="space-y-4 font-mono text-xs">
            <div className="bg-[#111] border border-[#333] rounded-lg p-4">
              <div className="text-[#e5e5e5] mb-1">get_decisions</div>
              <div className="text-[#666]">
                Returns all locked decisions for the workspace.
              </div>
            </div>
            <div className="bg-[#111] border border-[#333] rounded-lg p-4">
              <div className="text-[#e5e5e5] mb-1">get_decision</div>
              <div className="text-[#666]">
                Returns a specific decision by ID with full context.
              </div>
            </div>
            <div className="bg-[#111] border border-[#333] rounded-lg p-4">
              <div className="text-[#e5e5e5] mb-1">get_documents</div>
              <div className="text-[#666]">
                Returns all documents in the workspace.
              </div>
            </div>
            <div className="bg-[#111] border border-[#333] rounded-lg p-4">
              <div className="text-[#e5e5e5] mb-1">get_document</div>
              <div className="text-[#666]">
                Returns a specific document by ID with full content.
              </div>
            </div>
            <div className="bg-[#111] border border-[#333] rounded-lg p-4">
              <div className="text-[#e5e5e5] mb-1">search_decisions</div>
              <div className="text-[#666]">
                Search decisions by keyword or category.
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="border-t border-[#333] pt-8">
          <p className="text-xs text-[#666]">
            Questions? Reach out at{' '}
            <a href="mailto:hello@meter.chat" className="text-[#999] hover:text-[#e5e5e5]">
              hello@meter.chat
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { Copy, Plus, Trash2, Check, Key, AlertTriangle } from 'lucide-react'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  last_used_at: string | null
  created_at: string
}

interface ApiKeysSectionProps {
  workspaceId: string
}

export function ApiKeysSection({ workspaceId }: ApiKeysSectionProps) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch(`/api/keys?workspace_id=${workspaceId}`)
      const data = await res.json()
      setKeys(data.keys ?? [])
    } catch {
      // silent fail
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      })
      const data = await res.json()
      if (data.key) {
        setNewKey(data.key)
        fetchKeys()
      }
    } catch {
      // silent fail
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (keyId: string) => {
    setRevoking(keyId)
    try {
      await fetch('/api/keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_id: keyId }),
      })
      fetchKeys()
    } catch {
      // silent fail
    } finally {
      setRevoking(null)
    }
  }

  const handleCopy = async () => {
    if (!newKey) return
    await navigator.clipboard.writeText(newKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            API Key
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Connect Meter to external tools via MCP
          </p>
        </div>
        {keys.length === 0 && !loading && (
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium 
                       bg-[var(--text-primary)] text-[var(--bg-primary)] rounded-md
                       hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Plus size={12} />
            {creating ? 'Generating...' : 'Generate'}
          </button>
        )}
      </div>

      {/* New key reveal - shown once only */}
      {newKey && (
        <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-500">
              Copy this key now. It will not be shown again.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono text-[var(--text-primary)] 
                             bg-[var(--bg-primary)] px-3 py-2 rounded border 
                             border-[var(--border-primary)] truncate select-all">
              {newKey}
            </code>
            <button
              onClick={handleCopy}
              className="p-2 rounded-md hover:bg-[var(--bg-secondary)] transition-colors shrink-0"
            >
              {copied ? (
                <Check size={14} className="text-green-500" />
              ) : (
                <Copy size={14} className="text-[var(--text-secondary)]" />
              )}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="mt-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Existing keys */}
      {loading ? (
        <div className="text-xs text-[var(--text-tertiary)] py-4 text-center">
          Loading...
        </div>
      ) : keys.length > 0 ? (
        <div className="space-y-2">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg
                         bg-[var(--bg-secondary)] border border-[var(--border-primary)]"
            >
              <div className="flex items-center gap-2.5">
                <Key size={13} className="text-[var(--text-tertiary)]" />
                <div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-[var(--text-secondary)]">
                      {k.key_prefix}...
                    </code>
                  </div>
                  <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                    Created {formatDate(k.created_at)}
                    {k.last_used_at && ` · Last used ${formatDate(k.last_used_at)}`}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleRevoke(k.id)}
                disabled={revoking === k.id}
                className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors
                           text-[var(--text-tertiary)] hover:text-red-400"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : !newKey ? (
        <div className="text-center py-6 text-xs text-[var(--text-tertiary)]">
          No API keys yet. Generate one to connect Meter to external tools.
        </div>
      ) : null}

      {/* Link to connect docs */}
      <a
        href="/connect"
        className="inline-flex items-center gap-1 text-xs text-[var(--text-tertiary)] 
                   hover:text-[var(--text-secondary)] transition-colors"
      >
        Learn how to connect →
      </a>
    </div>
  )
}

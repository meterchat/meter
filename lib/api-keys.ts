import { createClient } from '@/utils/supabase/server'
import crypto from 'crypto'

const API_KEY_PREFIX = 'mtr_'

/**
 * Generate a new API key for a workspace.
 * Returns the full key (only shown once) and stores the hash.
 */
export async function generateApiKey(workspaceId: string, name: string = 'Default') {
  const supabase = await createClient()
  
  // Generate a random key
  const randomBytes = crypto.randomBytes(32).toString('hex')
  const fullKey = `${API_KEY_PREFIX}${randomBytes}`
  
  // Hash for storage
  const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex')
  
  // Prefix for display
  const keyPrefix = fullKey.substring(0, 12)
  
  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      workspace_id: workspaceId,
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
    })
    .select('id, name, key_prefix, created_at')
    .single()
  
  if (error) throw error
  
  return {
    ...data,
    key: fullKey, // Only returned at creation time
  }
}

/**
 * Validate an API key and return the associated workspace.
 * Updates last_used_at on successful validation.
 */
export async function validateApiKey(apiKey: string) {
  const supabase = await createClient()
  
  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    return null
  }
  
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex')
  
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, workspace_id, name')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single()
  
  if (error || !data) return null
  
  // Update last used
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
  
  return data
}

/**
 * List all active API keys for a workspace (hashed, never the full key).
 */
export async function listApiKeys(workspaceId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, last_used_at, created_at')
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data ?? []
}

/**
 * Revoke an API key (soft delete).
 */
export async function revokeApiKey(keyId: string) {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
  
  if (error) throw error
}

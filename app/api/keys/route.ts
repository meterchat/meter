import { NextRequest, NextResponse } from 'next/server'
import { generateApiKey, listApiKeys, revokeApiKey } from '@/lib/api-keys'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspace_id')
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })

  try {
    const keys = await listApiKeys(workspaceId)
    return NextResponse.json({ keys })
  } catch {
    return NextResponse.json({ error: 'Failed to list keys' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { workspace_id, name } = body

  if (!workspace_id) return NextResponse.json({ error: 'workspace_id required' }, { status: 400 })

  try {
    const result = await generateApiKey(workspace_id, name || 'Default')
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Failed to generate key' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { key_id } = body

  if (!key_id) return NextResponse.json({ error: 'key_id required' }, { status: 400 })

  try {
    await revokeApiKey(key_id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 })
  }
}

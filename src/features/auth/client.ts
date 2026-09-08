import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type PublicCloudConfig = { url: string; key: string; origins: string[] }
export function readCloudConfig(): PublicCloudConfig | null {
  try {
    const url = new URL(import.meta.env.VITE_SUPABASE_URL ?? '')
    const key: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)
    if ((!local && (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co'))) || (local && !['http:', 'https:'].includes(url.protocol)) || url.username || url.password) return null
    const legacy = key.split('.')
    const publicKey = /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key) || (legacy.length === 3 && JSON.parse(atob(legacy[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon')
    const origins = String(import.meta.env.VITE_AUTH_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
    if (!publicKey || !origins.includes(window.location.origin)) return null
    return { url: url.origin, key, origins }
  } catch { return null }
}

let client: SupabaseClient | null | undefined
export function getAuthClient() {
  if (client === undefined) {
    const config = readCloudConfig()
    client = config ? createClient(config.url, config.key, { auth: { flowType: 'pkce', detectSessionInUrl: false } }) : null
  }
  return client
}

export function safeReturnPath(value: string | null): string {
  // Only known routes; no protocol-relative, encoded slash, backslash, or arbitrary URL.
  return value && /^(\/|\/create|\/templates|\/my-stickers|\/editor\/[a-zA-Z0-9-]+)$/.test(value) ? value : '/my-stickers'
}

// Google sign-in shared by Calendar and Drive. Browsers use Google Identity
// Services (a short-lived token in this tab); the desktop and Android apps
// use the loopback + PKCE flow in the Rust host, which also returns a refresh
// token so they stay connected across restarts. Each integration keeps its
// own token and asks only for its own narrow scope.
import { useSettings } from './settings'
import { isTauri } from './vault'

export interface GoogleToken {
  access_token: string
  expires_at: number
  refresh_token?: string
}

export class GoogleAuthError extends Error {
  constructor(what = 'Google') {
    super(`${what} sign-in expired — reconnect to keep syncing.`)
  }
}

let gisLoading: Promise<void> | null = null
export function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve()
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisLoading = null
      reject(new Error('Could not load Google sign-in (offline?)'))
    }
    document.head.appendChild(s)
  })
  return gisLoading
}

export function createGoogleAuth(opts: { key: string; scope: string; what: string }) {
  // Browsers keep only the short-lived access token (this tab); the apps
  // also keep the refresh token so they can reconnect after a restart.
  const storage = () => (isTauri() ? localStorage : sessionStorage)

  const load = (): GoogleToken | null => {
    try {
      const raw = storage().getItem(opts.key)
      const t = raw ? (JSON.parse(raw) as GoogleToken) : null
      if (!t) return null
      if (t.expires_at < Date.now() + 60_000 && !t.refresh_token) return null
      return t
    } catch {
      return null
    }
  }
  const save = (t: GoogleToken | null) => {
    if (t) storage().setItem(opts.key, JSON.stringify(t))
    else storage().removeItem(opts.key)
  }

  /** Must be called from a user gesture (it opens Google's consent page). */
  const connect = async () => {
    const { gcalClientId, gcalClientSecret } = useSettings.getState()
    if (!gcalClientId) throw new Error('Add your Google OAuth client ID first (Make it yours → Google).')
    let token: GoogleToken
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      const r = await invoke<{ access_token: string; expires_in: number; refresh_token?: string }>('google_oauth_start', {
        clientId: gcalClientId,
        clientSecret: gcalClientSecret,
        scope: opts.scope,
      })
      token = { access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000, refresh_token: r.refresh_token }
    } else {
      await loadGis()
      token = await new Promise<GoogleToken>((resolve, reject) => {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: gcalClientId,
          scope: opts.scope,
          callback: (r: any) =>
            r.error ? reject(new Error(r.error_description ?? r.error)) : resolve({ access_token: r.access_token, expires_at: Date.now() + Number(r.expires_in) * 1000 }),
          error_callback: (e: any) => reject(new Error(e?.message ?? e?.type ?? 'Sign-in was cancelled')),
        })
        client.requestAccessToken({ prompt: '' })
      })
    }
    save(token)
  }

  const disconnect = () => {
    const t = load()
    if (t && !isTauri()) (window as any).google?.accounts?.oauth2?.revoke?.(t.access_token)
    save(null)
  }

  const accessToken = async (): Promise<string> => {
    const t = load()
    if (!t) throw new GoogleAuthError(opts.what)
    if (t.expires_at > Date.now() + 60_000) return t.access_token
    if (t.refresh_token && isTauri()) {
      const { gcalClientId, gcalClientSecret } = useSettings.getState()
      const { invoke } = await import('@tauri-apps/api/core')
      const r = await invoke<{ access_token: string; expires_in: number }>('google_oauth_refresh', {
        clientId: gcalClientId,
        clientSecret: gcalClientSecret,
        refreshToken: t.refresh_token,
      })
      const next = { ...t, access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000 }
      save(next)
      return next.access_token
    }
    throw new GoogleAuthError(opts.what)
  }

  return { load, save, connect, disconnect, accessToken, connected: () => !!load() }
}

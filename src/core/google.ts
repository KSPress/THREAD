// Google sign-in shared by Calendar and Drive. Browsers use Google Identity
// Services, desktop uses loopback + PKCE, and Android uses Play services.
import { useSettings } from './settings'
import { isMobileOS, isTauri } from './vault'

export const usesAndroidGoogle = () => isTauri() && isMobileOS() && /Android/i.test(navigator.userAgent)

function googleClient() {
  const { gcalClientId, gcalClientSecret } = useSettings.getState()
  if (gcalClientId) return { clientId: gcalClientId, clientSecret: gcalClientSecret }
  if (isTauri()) return {
    clientId: import.meta.env.VITE_THREAD_GOOGLE_DESKTOP_CLIENT_ID?.trim(),
    clientSecret: '',
  }
  return { clientId: import.meta.env.VITE_THREAD_GOOGLE_WEB_CLIENT_ID?.trim(), clientSecret: '' }
}

export const googleConfigured = () => usesAndroidGoogle() || !!googleClient().clientId

async function androidToken(scope: string, interactive: boolean): Promise<GoogleToken> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    const access_token = await invoke<string>('google_android_authorize', { scope, interactive })
    return { access_token, expires_at: Date.now() + 45 * 60_000 }
  } catch (error) {
    if (!interactive) throw new GoogleAuthError()
    if (String(error).includes('not found')) throw new Error('Install the latest Thread APK to connect Google Drive.')
    throw error
  }
}

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
      if (t.expires_at < Date.now() + 60_000 && !t.refresh_token && !usesAndroidGoogle()) return null
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
    if (usesAndroidGoogle()) return save(await androidToken(opts.scope, true))
    const { clientId, clientSecret } = googleClient()
    if (!clientId) throw new Error('Google Drive or Calendar is unavailable in this build. You can still use a local vault.')
    let token: GoogleToken
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      const r = await invoke<{ access_token: string; expires_in: number; refresh_token?: string }>('google_oauth_start', {
        clientId,
        clientSecret,
        scope: opts.scope,
      })
      token = { access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000, refresh_token: r.refresh_token }
    } else {
      await loadGis()
      token = await new Promise<GoogleToken>((resolve, reject) => {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: opts.scope,
          include_granted_scopes: false,
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
    if (usesAndroidGoogle()) {
      const next = await androidToken(opts.scope, false)
      save(next)
      return next.access_token
    }
    if (t.refresh_token && isTauri()) {
      const { clientId, clientSecret } = googleClient()
      const { invoke } = await import('@tauri-apps/api/core')
      const r = await invoke<{ access_token: string; expires_in: number }>('google_oauth_refresh', {
        clientId,
        clientSecret,
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

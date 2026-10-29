// One "Sign in with Google" for everything THREAD does with Google: a single
// consent for Calendar (calendars THREAD creates) and Drive (files THREAD
// creates). The token is handed to both integrations, which keep using their
// own narrow scopes from then on.
import { create } from 'zustand'
import { DRIVE_SCOPE } from './drive'
import { GCAL_SCOPE, useGcal } from './gcal'
import { createGoogleAuth } from './google'
import { useDrive } from './gdrive'
import { isTauri } from './vault'

const KEYS = { account: 'thread.google.token', gcal: 'thread.gcal.token', drive: 'thread.gdrive.token' }
const auth = createGoogleAuth({ key: KEYS.account, scope: `${GCAL_SCOPE} ${DRIVE_SCOPE}`, what: 'Google' })
const storage = () => (isTauri() ? localStorage : sessionStorage)

export const useGoogleAccount = create<{ signedIn: boolean; busy: boolean; error?: string }>(() => ({ signedIn: auth.connected(), busy: false }))

/** Call from a click: Google's consent page opens (browser popup, or the system browser in the apps). */
export async function signInGoogle() {
  useGoogleAccount.setState({ busy: true, error: undefined })
  try {
    await auth.connect()
    const token = storage().getItem(KEYS.account)!
    storage().setItem(KEYS.gcal, token)
    storage().setItem(KEYS.drive, token)
    useGcal.setState({ status: 'connected', error: undefined })
    if (useDrive.getState().status === 'expired') useDrive.setState({ status: 'idle', error: undefined })
    useGoogleAccount.setState({ signedIn: true, busy: false })
  } catch (e) {
    useGoogleAccount.setState({ busy: false, error: String((e as Error).message ?? e) })
    throw e
  }
}

export function signOutGoogle() {
  auth.disconnect()
  for (const k of [KEYS.gcal, KEYS.drive]) storage().removeItem(k)
  useGcal.setState({ status: 'disconnected' })
  if (useDrive.getState().folder) useDrive.setState({ status: 'expired' })
  useGoogleAccount.setState({ signedIn: false })
}

/** Signed in through any route (this button, or Calendar/Drive settings). */
export const anyGoogleSignIn = () => auth.connected() || !!storage().getItem(KEYS.drive) || !!storage().getItem(KEYS.gcal)

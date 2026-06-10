import type { SpindleAPI } from 'lumiverse-spindle-types'
import {
  DEFAULT_SESSION_STATE,
  DEFAULT_USER_SETTINGS,
  type SessionState,
  type UserSettings,
} from '../shared/contracts'

const SETTINGS_PATH = 'phase1/settings.json'
const SESSION_PATH = 'phase1/session-state.json'

export async function readUserSettings(
  spindle: SpindleAPI,
  userId: string,
): Promise<UserSettings> {
  return spindle.userStorage.getJson<UserSettings>(SETTINGS_PATH, {
    fallback: DEFAULT_USER_SETTINGS,
    userId,
  })
}

export async function writeUserSettings(
  spindle: SpindleAPI,
  userId: string,
  settings: UserSettings,
): Promise<void> {
  await spindle.userStorage.setJson(SETTINGS_PATH, settings, {
    indent: 2,
    userId,
  })
}

export async function readSessionState(
  spindle: SpindleAPI,
  userId: string,
): Promise<SessionState> {
  return spindle.userStorage.getJson<SessionState>(SESSION_PATH, {
    fallback: DEFAULT_SESSION_STATE,
    userId,
  })
}

export async function writeSessionState(
  spindle: SpindleAPI,
  userId: string,
  session: SessionState,
): Promise<void> {
  await spindle.userStorage.setJson(SESSION_PATH, session, {
    indent: 2,
    userId,
  })
}

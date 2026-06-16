import type { SpindleAPI } from 'lumiverse-spindle-types'
import {
  CALIBRATABLE_ACTION_TYPES,
  CALIBRATION_EXECUTION_PROFILES,
  ALL_ACTION_TYPES,
  DEFAULT_CHAT_TRACKING_PREFERENCES,
  DEFAULT_USER_SETTINGS,
  type ActionCalibrationPreset,
  type ChatTrackingPreferences,
  type ParticipantProfile,
  type XToysActionMappingSettings,
  type UserSettings,
} from '../shared/contracts'

const SETTINGS_PATH = 'phase1/settings.json'
const PARTICIPANT_PROFILES_PATH = 'phase5/participant-profiles.json'
const CHAT_TRACKING_PREFERENCES_PATH = 'phase7/chat-tracking-preferences.json'

interface ParticipantProfileStore {
  profiles: Record<string, ParticipantProfile>
}

interface ChatTrackingPreferenceStore {
  chats: Record<string, ChatTrackingPreferences>
}

function buildDefaultActionMappings(): XToysActionMappingSettings[] {
  return ALL_ACTION_TYPES.map((semanticActionType) => ({
    semanticActionType,
    xtoysActionName: semanticActionType,
    fallbackActionName: null,
    supported: semanticActionType !== 'pause',
    updatedAt: null,
  }))
}

function buildDefaultActionCalibrationPresets(): ActionCalibrationPreset[] {
  return CALIBRATABLE_ACTION_TYPES.map((semanticActionType, index) => ({
    semanticActionType,
    supported: true,
    fallbackTarget: null,
    baseAmplitude: 50,
    baseTempo: 50,
    preferredExecutionProfile:
      semanticActionType === 'thrust' ? 'pattern_funscript' : CALIBRATION_EXECUTION_PROFILES[0],
    preferredTransitionStyle: semanticActionType === 'pulse' ? 'abrupt' : 'smooth',
    repeatStyle:
      semanticActionType === 'pulse' ? 'once' : semanticActionType === 'tease' ? 'loop' : 'hold',
    holdTendency: index % 2 === 0 ? 60 : 50,
    revision: 1,
  }))
}

function mergeSettings(settings: UserSettings): UserSettings {
  const mappingsByType = new Map(
    (settings.xtoysActionMappings ?? []).map((mapping) => [mapping.semanticActionType, mapping]),
  )
  const calibrationsByType = new Map(
    (settings.actionCalibrationPresets ?? []).map((preset) => [preset.semanticActionType, preset]),
  )

  const merged: UserSettings = {
    parser: {
      ...DEFAULT_USER_SETTINGS.parser,
      ...settings.parser,
    },
    xtoysDelivery: {
      ...DEFAULT_USER_SETTINGS.xtoysDelivery,
      ...settings.xtoysDelivery,
    },
    ui: {
      ...DEFAULT_USER_SETTINGS.ui,
      ...settings.ui,
    },
    xtoysActionMappings: buildDefaultActionMappings().map((mapping) => ({
      ...mapping,
      ...mappingsByType.get(mapping.semanticActionType),
    })),
    actionCalibrationPresets: buildDefaultActionCalibrationPresets().map((preset) => ({
      ...preset,
      ...calibrationsByType.get(preset.semanticActionType),
    })),
  }

  // Migrate the earlier compatibility-mode default to the field name XToys actually reacts to.
  merged.xtoysDelivery.mode = 'action_trigger_compat'

  if (merged.xtoysDelivery.triggerFieldName === 'sendTrigger') {
    merged.xtoysDelivery.triggerFieldName = 'action'
  }

  return merged
}

function mergeChatTrackingPreferences(
  preferences: Partial<ChatTrackingPreferences> | null | undefined,
  settings: UserSettings,
): ChatTrackingPreferences {
  return {
    ...DEFAULT_CHAT_TRACKING_PREFERENCES,
    primaryContactZone: settings.parser.primaryUserContactZone,
    customContactZone: settings.parser.customUserContactZone,
    ...preferences,
  }
}

export async function readUserSettings(
  spindle: SpindleAPI,
  userId: string,
): Promise<UserSettings> {
  const settings = await spindle.userStorage.getJson<UserSettings>(SETTINGS_PATH, {
    fallback: DEFAULT_USER_SETTINGS,
    userId,
  })
  return mergeSettings(settings)
}

export async function writeUserSettings(
  spindle: SpindleAPI,
  userId: string,
  settings: UserSettings,
): Promise<void> {
  await spindle.userStorage.setJson(SETTINGS_PATH, mergeSettings(settings), {
    indent: 2,
    userId,
  })
}

export async function readChatTrackingPreferenceStore(
  spindle: SpindleAPI,
  userId: string,
): Promise<ChatTrackingPreferenceStore> {
  return spindle.userStorage.getJson<ChatTrackingPreferenceStore>(CHAT_TRACKING_PREFERENCES_PATH, {
    fallback: { chats: {} },
    userId,
  })
}

export async function readChatTrackingPreferences(
  spindle: SpindleAPI,
  userId: string,
  chatId: string | null,
  settings: UserSettings,
): Promise<ChatTrackingPreferences> {
  if (!chatId) {
    return mergeChatTrackingPreferences(null, settings)
  }

  const store = await readChatTrackingPreferenceStore(spindle, userId)
  return mergeChatTrackingPreferences(store.chats[chatId], settings)
}

export async function writeChatTrackingPreferences(
  spindle: SpindleAPI,
  userId: string,
  chatId: string,
  preferences: ChatTrackingPreferences,
  settings: UserSettings,
): Promise<void> {
  const store = await readChatTrackingPreferenceStore(spindle, userId)
  store.chats[chatId] = mergeChatTrackingPreferences(preferences, settings)

  await spindle.userStorage.setJson(CHAT_TRACKING_PREFERENCES_PATH, store, {
    indent: 2,
    userId,
  })
}

export async function readParticipantProfileStore(
  spindle: SpindleAPI,
  userId: string,
): Promise<ParticipantProfileStore> {
  return spindle.userStorage.getJson<ParticipantProfileStore>(PARTICIPANT_PROFILES_PATH, {
    fallback: { profiles: {} },
    userId,
  })
}

export async function writeParticipantProfileStore(
  spindle: SpindleAPI,
  userId: string,
  store: ParticipantProfileStore,
): Promise<void> {
  await spindle.userStorage.setJson(PARTICIPANT_PROFILES_PATH, store, {
    indent: 2,
    userId,
  })
}

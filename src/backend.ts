declare const spindle: import('lumiverse-spindle-types').SpindleAPI

import type {
  ActionCalibrationPreset,
  ActionType,
  BackendToFrontendMessage,
  ConnectionProfileSummary,
  FrontendToBackendMessage,
  MessagePlan,
  ResolvedBeat,
  SemanticBeat,
  SessionState,
  UserSettings,
} from './shared/contracts'
import { readUserSettings, writeUserSettings } from './backend/storage'
import { DEFAULT_RUNTIME_PLAN_BUFFER, DEFAULT_SESSION_STATE } from './shared/contracts'

function sendToUser(message: BackendToFrontendMessage, userId: string) {
  spindle.sendToFrontend(message, userId)
}

function isFrontendMessage(payload: unknown): payload is FrontendToBackendMessage {
  return typeof payload === 'object' && payload !== null && 'type' in payload
}

const runtimeSessions = new Map<string, SessionState>()
const activeChatIds = new Map<string, string | null>()

function cloneDefaultSessionState(): SessionState {
  return {
    ...DEFAULT_SESSION_STATE,
    activeChatId: null,
    parserSession: {
      ...DEFAULT_SESSION_STATE.parserSession,
      continuityMemory: {},
    },
    heldState: {
      ...DEFAULT_SESSION_STATE.heldState,
    },
    runtimePlans: {
      ...DEFAULT_RUNTIME_PLAN_BUFFER,
    },
  }
}

function getRuntimeSession(userId: string): SessionState {
  const existing = runtimeSessions.get(userId)
  if (existing) return existing

  const created = cloneDefaultSessionState()
  runtimeSessions.set(userId, created)
  return created
}

function resetRuntimeSession(userId: string, chatId: string | null): SessionState {
  const next = cloneDefaultSessionState()
  next.activeChatId = chatId
  runtimeSessions.set(userId, next)
  activeChatIds.set(userId, chatId)
  return next
}

function syncSessionToChat(userId: string, chatId: string | null): SessionState {
  const currentChatId = activeChatIds.get(userId) ?? null
  if (currentChatId !== chatId) {
    return resetRuntimeSession(userId, chatId)
  }

  return getRuntimeSession(userId)
}

async function buildBootstrap(userId: string, chatId: string | null) {
  const settings = await readUserSettings(spindle, userId)
  const session = syncSessionToChat(userId, chatId)

  return { settings, session }
}

async function listAvailableConnections(userId: string): Promise<ConnectionProfileSummary[]> {
  let connections
  try {
    connections = await spindle.connections.list(userId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    spindle.log.warn(`Lummate settings bootstrap could not list connections: ${message}`)
    return []
  }

  return connections
    .map((connection) => ({
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      model: connection.model,
      isDefault: connection.is_default,
      hasApiKey: connection.has_api_key,
    }))
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
}

async function buildSettingsBootstrap(userId: string) {
  const [settings, availableConnections] = await Promise.all([
    readUserSettings(spindle, userId),
    listAvailableConnections(userId),
  ])

  return { settings, availableConnections }
}

function buildUpdatedSettings(current: UserSettings, incoming: UserSettings): UserSettings {
  return {
    parser: {
      ...current.parser,
      ...incoming.parser,
    },
    xtoysActionMappings: incoming.xtoysActionMappings,
    actionCalibrationPresets: incoming.actionCalibrationPresets,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function detectActionType(content: string): ActionType {
  const normalized = content.toLowerCase()

  if (normalized.includes('suction') || normalized.includes('suck')) return 'suction'
  if (normalized.includes('thrust')) return 'thrust'
  if (normalized.includes('grind')) return 'grind'
  if (normalized.includes('stroke')) return 'stroke'
  if (normalized.includes('lick')) return 'lick'
  if (normalized.includes('squeez')) return 'squeeze'
  if (normalized.includes('pulse')) return 'pulse'
  if (normalized.includes('teas')) return 'tease'
  return 'tease'
}

function detectStrength(content: string, preset: ActionCalibrationPreset): number {
  const normalized = content.toLowerCase()
  let value = preset.baseAmplitude

  if (/(hard|rough|urgent|desperate|intense|deep)/.test(normalized)) value += 20
  if (/(gentle|soft|slow|light|careful|brief)/.test(normalized)) value -= 15

  return clamp(value, 0, 100)
}

function detectTempo(content: string, preset: ActionCalibrationPreset): number {
  const normalized = content.toLowerCase()
  let value = preset.baseTempo

  if (/(fast|quick|rapid|frantic|urgent)/.test(normalized)) value += 20
  if (/(slow|lingering|steady|drawn out)/.test(normalized)) value -= 15

  return clamp(value, 0, 100)
}

function detectDurationMs(content: string): number {
  const normalized = content.toLowerCase()

  if (/(one |single |once|brief|briefly|quick)\b/.test(normalized)) return 1200
  if (/(long|linger|lingering|lasting|prolonged)\b/.test(normalized)) return 5000
  if (/(continue|keeps|keeping|still|ongoing)\b/.test(normalized)) return 6500
  return 3000
}

function detectDurationClass(content: string): SemanticBeat['durationClass'] {
  const normalized = content.toLowerCase()

  if (/(one |single |once)\b/.test(normalized)) return 'instant'
  if (/(brief|briefly|quick)\b/.test(normalized)) return 'very_short'
  if (/(long|linger|lingering|lasting|prolonged)\b/.test(normalized)) return 'long'
  if (/(continue|keeps|keeping|still|ongoing)\b/.test(normalized)) return 'ongoing'
  return 'medium'
}

function detectPersistence(content: string, preset: ActionCalibrationPreset): string {
  const normalized = content.toLowerCase()

  if (/(pulls away|stops|withdraws|lets go|breaks contact)\b/.test(normalized)) return 'stop'
  if (/(one |single |once)\b/.test(normalized)) return 'instant'
  if (/(continue|keeps|keeping|still|ongoing)\b/.test(normalized)) return 'ongoing'
  if (preset.repeatStyle === 'hold') return 'sustained'
  if (preset.repeatStyle === 'loop') return 'ongoing'
  return 'brief'
}

function resolveContinuityVerdict(
  previousPlan: MessagePlan | null,
  actionType: ActionType,
): MessagePlan['continuityVerdict'] {
  if (!previousPlan || previousPlan.resolvedBeats.length === 0) return null

  const previousAction = previousPlan.resolvedBeats[previousPlan.resolvedBeats.length - 1]?.actionType
  if (!previousAction) return null

  return previousAction === actionType ? 'modify' : 'replace'
}

function resolveTransitionMode(
  continuityVerdict: MessagePlan['continuityVerdict'],
): MessagePlan['transitionMode'] {
  if (continuityVerdict === 'modify') return 'modulate'
  if (continuityVerdict === 'replace') return 'replace'
  return null
}

async function buildMessagePlan(
  chatId: string,
  messageId: string,
  settings: UserSettings,
  session: SessionState,
): Promise<MessagePlan> {
  const messages = await spindle.chat.getMessages(chatId)
  const selected = messages.find((message) => message.id === messageId)

  if (!selected) {
    throw new Error(`Message ${messageId} was not found in chat ${chatId}`)
  }

  if (selected.role !== 'assistant') {
    throw new Error('Only assistant messages can be played')
  }

  const actionType = detectActionType(selected.content)
  const preset =
    settings.actionCalibrationPresets.find((entry) => entry.semanticActionType === actionType) ??
    settings.actionCalibrationPresets[0]

  if (!preset) {
    throw new Error('No tactile calibration presets are available')
  }

  const mapping =
    settings.xtoysActionMappings.find((entry) => entry.semanticActionType === actionType) ?? null

  const semanticBeat: SemanticBeat = {
    messageId,
    orderIndex: 0,
    actionType,
    strength: detectStrength(selected.content, preset),
    frequency: detectTempo(selected.content, preset),
    durationClass: detectDurationClass(selected.content),
    durationMs: detectDurationMs(selected.content),
    persistence: detectPersistence(selected.content, preset),
    responseMode: 'lead',
    actorWeight: 0.5,
    acteeWeight: 0.5,
    explicitChange: /\b(becomes|turns|shifts|changes|deepens|quickens)\b/i.test(selected.content),
    explicitStop: /\b(stops|withdraws|pulls away|breaks contact|lets go)\b/i.test(selected.content),
  }

  const resolvedBeat: ResolvedBeat = {
    messageId,
    orderIndex: 0,
    actionType,
    xtoysActionName:
      mapping?.xtoysActionName || mapping?.fallbackActionName || actionType,
    executionProfile: preset.preferredExecutionProfile,
    amplitude: semanticBeat.strength,
    tempo: semanticBeat.frequency,
    durationMs: semanticBeat.durationMs,
    persistence: semanticBeat.persistence,
  }

  const continuityVerdict = resolveContinuityVerdict(session.runtimePlans.currentPlan, actionType)
  const transitionMode = resolveTransitionMode(continuityVerdict)

  return {
    messageId,
    createdAt: new Date().toISOString(),
    playbackMode: preset.repeatStyle,
    semanticBeats: [semanticBeat],
    resolvedBeats: [resolvedBeat],
    continuityVerdict,
    transitionMode,
  }
}

async function handleFrontendMessage(
  payload: FrontendToBackendMessage,
  userId: string,
): Promise<void> {
  try {
    switch (payload.type) {
      case 'lummate.phase1.bootstrap': {
        const bootstrap = await buildBootstrap(userId, payload.payload.chatId)
        sendToUser(
          {
            type: 'lummate.phase1.bootstrap_result',
            payload: bootstrap,
          },
          userId,
        )
        return
      }
      case 'lummate.phase1.chat_changed': {
        const bootstrap = await buildBootstrap(userId, payload.payload.chatId)
        sendToUser(
          {
            type: 'lummate.phase1.session_state',
            payload: bootstrap,
          },
          userId,
        )
        return
      }
      case 'lummate.phase1.play_toggle': {
        const current = syncSessionToChat(userId, payload.payload.chatId)
        const nextActiveMessageId =
          current.activeMessageId === payload.payload.messageId
            ? null
            : payload.payload.messageId

        const settings = await readUserSettings(spindle, userId)
        const nextRuntimePlans = { ...current.runtimePlans }

        if (payload.payload.chatId && nextActiveMessageId) {
          const nextPlan = await buildMessagePlan(
            payload.payload.chatId,
            payload.payload.messageId,
            settings,
            current,
          )

          nextRuntimePlans.previousPlan = current.runtimePlans.currentPlan
          nextRuntimePlans.currentPlan = nextPlan
        }

        const nextSession: SessionState = {
          ...current,
          activeChatId: payload.payload.chatId,
          activeMessageId: nextActiveMessageId,
          lastPlayedMessageId: payload.payload.messageId,
          lastUpdatedAt: new Date().toISOString(),
          parserSession: {
            ...current.parserSession,
            armed: nextActiveMessageId !== null,
          },
          runtimePlans: nextRuntimePlans,
        }

        runtimeSessions.set(userId, nextSession)
        activeChatIds.set(userId, payload.payload.chatId)

        const bootstrap = await buildBootstrap(userId, payload.payload.chatId)
        sendToUser(
          {
            type: 'lummate.phase1.session_state',
            payload: bootstrap,
          },
          userId,
        )
        return
      }
      case 'lummate.settings.bootstrap': {
        const payload = await buildSettingsBootstrap(userId)
        sendToUser(
          {
            type: 'lummate.settings.bootstrap_result',
            payload,
          },
          userId,
        )
        return
      }
      case 'lummate.settings.save': {
        const current = await readUserSettings(spindle, userId)
        const nextSettings = buildUpdatedSettings(current, payload.payload.settings)

        await writeUserSettings(spindle, userId, nextSettings)

        const settingsBootstrap = await buildSettingsBootstrap(userId)
        sendToUser(
          {
            type: 'lummate.settings.save_result',
            payload: settingsBootstrap,
          },
          userId,
        )
        return
      }
      default: {
        const exhaustiveCheck: never = payload
        spindle.log.warn(`Unhandled frontend payload: ${JSON.stringify(exhaustiveCheck)}`)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown backend error'
    spindle.log.error(`Lummate phase 1 backend error: ${message}`)
    sendToUser(
      {
        type: 'lummate.phase1.error',
        message,
      },
      userId,
    )
  }
}

spindle.onFrontendMessage((payload, userId) => {
  if (!isFrontendMessage(payload)) {
    spindle.log.warn('Ignoring unknown frontend payload')
    return
  }

  void handleFrontendMessage(payload, userId)
})

spindle.log.info('Lummate phase 1 backend loaded')

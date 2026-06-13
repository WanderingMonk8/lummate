declare const spindle: import('lumiverse-spindle-types').SpindleAPI

import type {
  ActionCalibrationPreset,
  ActionType,
  BackendToFrontendMessage,
  ChatTrackingPreferences,
  ConnectionProfileSummary,
  EndOfPlaybackResolution,
  FrontendToBackendMessage,
  HeldState,
  MechanicalAxes,
  MessagePlan,
  PlaybackMode,
  ParticipantKind,
  ParticipantProfile,
  ParticipantProfileBundle,
  UserContactZone,
  ParticipantStateAssignment,
  ParticipantState,
  ResolvedBeat,
  SemanticBeat,
  SessionState,
  XToysActionMappingSettings,
  UserSettings,
} from './shared/contracts'
import type { LlmMessageDTO } from 'lumiverse-spindle-types'
import { ensureParticipantProfileBundle } from './backend/participant-profiles'
import {
  readChatTrackingPreferences,
  readUserSettings,
  writeChatTrackingPreferences,
  writeUserSettings,
} from './backend/storage'
import {
  DEFAULT_MECHANICAL_AXES,
  DEFAULT_RUNTIME_PLAN_BUFFER,
  DEFAULT_SESSION_STATE,
} from './shared/contracts'

interface LlmParserParticipantStatePayload {
  arousal?: number
  energy?: number
  steadiness?: number
  focus?: number
  provenance?: 'parsed' | 'baseline'
}

interface LlmParserParticipantPayload {
  label: string
  is_user: boolean
  side: 'actor' | 'actee'
  weight: number
  state?: LlmParserParticipantStatePayload
}

interface LlmParserBeatPayload {
  order_index: number
  source_excerpt?: string
  action_type: ActionType
  strength: number
  frequency: number
  duration_class: SemanticBeat['durationClass']
  duration_ms?: number
  transition_style?: SemanticBeat['transitionStyle']
  count_hint?: SemanticBeat['countHint']
  persistence: string
  response_mode: SemanticBeat['responseMode']
  explicit_change: boolean
  explicit_stop: boolean
  actor_weight: number
  actee_weight: number
  fallback_behavior?: SemanticBeat['fallbackBehavior']
}

interface LlmParserScenePayload {
  relevant: boolean
  continuity_verdict: MessagePlan['continuityVerdict'] | null
  participants: LlmParserParticipantPayload[]
  beats: LlmParserBeatPayload[]
}

const PARSE_SCENE_TOOL = {
  name: 'parse_tactile_scene',
  description:
    'Parse one assistant roleplay message into relevant tactile beats, participant inclusion, participant states, and continuity relative to the tracked participant contact zone.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      relevant: { type: 'boolean' },
      continuity_verdict: {
        anyOf: [
          { type: 'string', enum: ['continue', 'progress', 'modify', 'replace', 'stop'] },
          { type: 'null' },
        ],
      },
      participants: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string' },
            is_user: { type: 'boolean' },
            side: { type: 'string', enum: ['actor', 'actee'] },
            weight: { type: 'number' },
            state: {
              type: 'object',
              additionalProperties: false,
              properties: {
                arousal: { type: 'number' },
                energy: { type: 'number' },
                steadiness: { type: 'number' },
                focus: { type: 'number' },
                provenance: { type: 'string', enum: ['parsed', 'baseline'] },
              },
            },
          },
          required: ['label', 'is_user', 'side', 'weight'],
        },
      },
      beats: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            order_index: { type: 'integer' },
            source_excerpt: { type: 'string' },
            action_type: {
              type: 'string',
              enum: ['tease', 'stroke', 'thrust', 'suction', 'grind', 'pulse', 'lick', 'squeeze', 'pause'],
            },
            strength: { type: 'number' },
            frequency: { type: 'number' },
            duration_class: {
              type: 'string',
              enum: ['instant', 'very_short', 'short', 'medium', 'long', 'extended', 'ongoing'],
            },
            duration_ms: { type: 'number' },
            transition_style: {
              type: 'string',
              enum: ['ramp', 'snap', 'pulse', 'fade', 'steady', 'unknown'],
            },
            count_hint: {
              type: 'string',
              enum: ['one_shot', 'few', 'repeated', 'continuous', 'unknown'],
            },
            persistence: { type: 'string' },
            response_mode: { type: 'string', enum: ['lead', 'meet', 'withdraw', 'mutual'] },
            explicit_change: { type: 'boolean' },
            explicit_stop: { type: 'boolean' },
            actor_weight: { type: 'number' },
            actee_weight: { type: 'number' },
            fallback_behavior: {
              type: 'string',
              enum: ['resume_previous', 'idle', 'hold_last', 'clear', 'unknown'],
            },
          },
          required: [
            'order_index',
            'source_excerpt',
            'action_type',
            'strength',
            'frequency',
            'duration_class',
            'duration_ms',
            'transition_style',
            'count_hint',
            'persistence',
            'response_mode',
            'explicit_change',
            'explicit_stop',
            'actor_weight',
            'actee_weight',
            'fallback_behavior',
          ],
        },
      },
    },
    required: ['relevant', 'continuity_verdict', 'participants', 'beats'],
  },
} as const

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
    activeCharacterId: null,
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

function resetRuntimeSession(
  userId: string,
  chatId: string | null,
  characterId: string | null,
): SessionState {
  const next = cloneDefaultSessionState()
  next.activeChatId = chatId
  next.activeCharacterId = characterId
  runtimeSessions.set(userId, next)
  activeChatIds.set(userId, chatId)
  return next
}

function syncSessionToChat(
  userId: string,
  chatId: string | null,
  characterId: string | null,
): SessionState {
  const currentChatId = activeChatIds.get(userId) ?? null
  if (currentChatId !== chatId) {
    return resetRuntimeSession(userId, chatId, characterId)
  }

  const session = getRuntimeSession(userId)
  if (session.activeCharacterId !== characterId) {
    session.activeCharacterId = characterId
  }
  return session
}

async function buildBootstrap(userId: string, chatId: string | null, characterId: string | null) {
  const settings = await readUserSettings(spindle, userId)
  const [chatPreferences, participantProfiles] = await Promise.all([
    readChatTrackingPreferences(spindle, userId, chatId, settings),
    getParticipantProfilesSafely(userId, chatId, characterId),
  ])
  const session = syncSessionToChat(userId, chatId, characterId)

  return { settings, session, chatPreferences, participantProfiles }
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

async function buildSettingsBootstrap(
  userId: string,
  chatId: string | null,
  characterId: string | null,
): Promise<{
  settings: UserSettings
  availableConnections: ConnectionProfileSummary[]
  participantProfiles: ParticipantProfileBundle
  chatPreferences: ChatTrackingPreferences
}> {
  const settings = await readUserSettings(spindle, userId)
  const [availableConnections, participantProfiles, chatPreferences] = await Promise.all([
    listAvailableConnections(userId),
    getParticipantProfilesSafely(userId, chatId, characterId),
    readChatTrackingPreferences(spindle, userId, chatId, settings),
  ])

  return { settings, availableConnections, participantProfiles, chatPreferences }
}

async function getParticipantProfilesSafely(
  userId: string,
  chatId: string | null,
  characterId: string | null,
  forceOptions?: {
    forceUserRegenerate?: boolean
    forceCharacterRegenerate?: boolean
  },
): Promise<ParticipantProfileBundle> {
  try {
    return await ensureParticipantProfileBundle(spindle, userId, {
      chatId,
      characterId,
      ...forceOptions,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    spindle.log.warn(`Lummate profile derivation unavailable: ${message}`)
    return {
      userProfile: null,
      characterProfiles: [],
    }
  }
}

function resolveParserConnectionId(settings: UserSettings): string | undefined {
  if (settings.parser.parserConnectionId) {
    return settings.parser.parserConnectionId
  }

  if (settings.parser.fallbackBehavior === 'default_connection') {
    return undefined
  }

  throw new Error('No parser connection configured and fallback behavior is fail closed')
}

function summarizeParticipantProfiles(participantProfiles: ParticipantProfileBundle): string {
  const userSummary = participantProfiles.userProfile
    ? `User persona: ${participantProfiles.userProfile.displayName}`
    : 'User persona: unavailable'

  const characterSummary =
    participantProfiles.characterProfiles.length > 0
      ? `Characters: ${participantProfiles.characterProfiles
          .map((profile) => profile.displayName)
          .join(', ')}`
      : 'Characters: none'

  return `${userSummary}\n${characterSummary}`
}

function buildUserReferenceHints(participantProfiles: ParticipantProfileBundle): string[] {
  const hints = ['you', 'your', 'yours', 'yourself']
  const userName = participantProfiles.userProfile?.displayName?.trim() ?? ''

  if (userName) {
    hints.push(userName)
    for (const token of userName.split(/\s+/)) {
      if (token.trim().length >= 2) {
        hints.push(token.trim())
      }
    }
  }

  // Only add third-person aliases when we have an actual user profile anchor.
  if (userName) {
    hints.push('him', 'his', 'he')
  }

  return [...new Set(hints)]
}

function buildUserPossessiveReferenceHints(participantProfiles: ParticipantProfileBundle): string[] {
  const hints = ['your', 'yours']
  const userName = participantProfiles.userProfile?.displayName?.trim() ?? ''

  if (userName) {
    hints.push('his')
    hints.push(`${userName}'s`)
    hints.push(`${userName.toLowerCase()}'s`)
  }

  return [...new Set(hints)]
}

function resolveTrackedParticipantProfile(
  participantProfiles: ParticipantProfileBundle,
  chatPreferences: ChatTrackingPreferences,
): ParticipantProfile | null {
  if (chatPreferences.trackedParticipantKind === 'persona') {
    return participantProfiles.userProfile
  }

  if (chatPreferences.trackedParticipantId) {
    return (
      participantProfiles.characterProfiles.find(
        (profile) => profile.participantId === chatPreferences.trackedParticipantId,
      ) ?? null
    )
  }

  return participantProfiles.userProfile
}

function buildTrackedReferenceHints(
  participantProfiles: ParticipantProfileBundle,
  chatPreferences: ChatTrackingPreferences,
): string[] {
  const trackedProfile = resolveTrackedParticipantProfile(participantProfiles, chatPreferences)

  if (!trackedProfile || trackedProfile.participantKind === 'persona') {
    return buildUserReferenceHints(participantProfiles)
  }

  const hints = [trackedProfile.displayName, ...trackedProfile.aliasHints]

  for (const token of trackedProfile.displayName.split(/\s+/)) {
    if (token.trim().length >= 2) {
      hints.push(token.trim())
    }
  }

  return [...new Set(hints.filter((hint) => hint.trim().length > 0))]
}

function buildTrackedPossessiveReferenceHints(
  participantProfiles: ParticipantProfileBundle,
  chatPreferences: ChatTrackingPreferences,
): string[] {
  const trackedProfile = resolveTrackedParticipantProfile(participantProfiles, chatPreferences)

  if (!trackedProfile || trackedProfile.participantKind === 'persona') {
    return buildUserPossessiveReferenceHints(participantProfiles)
  }

  const hints = [`${trackedProfile.displayName}'s`, `${trackedProfile.displayName.toLowerCase()}'s`]

  for (const alias of trackedProfile.aliasHints) {
    const trimmedAlias = alias.trim()
    if (trimmedAlias.length > 0) {
      hints.push(`${trimmedAlias}'s`)
      hints.push(`${trimmedAlias.toLowerCase()}'s`)
    }
  }

  return [...new Set(hints.filter((hint) => hint.trim().length > 0))]
}

function resolveDurationMsFromClass(durationClass: SemanticBeat['durationClass']): number {
  switch (durationClass) {
    case 'instant':
      return 900
    case 'very_short':
      return 1500
    case 'short':
      return 2500
    case 'medium':
      return 4000
    case 'long':
      return 6500
    case 'extended':
      return 9000
    case 'ongoing':
      return 12000
    default:
      return 3000
  }
}

function resolveDurationClassFromMs(durationMs: number): SemanticBeat['durationClass'] {
  if (durationMs <= 1000) return 'instant'
  if (durationMs <= 1800) return 'very_short'
  if (durationMs <= 3200) return 'short'
  if (durationMs <= 5200) return 'medium'
  if (durationMs <= 8000) return 'long'
  if (durationMs <= 12000) return 'extended'
  return 'ongoing'
}

function parseExplicitCountHint(text: string): number | null {
  const digitMatch = text.match(/\b(\d{1,3})\b/)
  if (digitMatch) {
    const parsed = Number(digitMatch[1])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  const numberWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
  }

  for (const [word, value] of Object.entries(numberWords)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) {
      return value
    }
  }

  return null
}

function parseExplicitDurationSeconds(text: string): number | null {
  const digitMatch = text.match(/\b(\d{1,3})\s*(?:second|seconds|sec|secs)\b/i)
  if (digitMatch) {
    const parsed = Number(digitMatch[1])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  const numberWords: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
  }

  for (const [word, value] of Object.entries(numberWords)) {
    if (new RegExp(`\\b${word}\\s+(?:second|seconds|sec|secs)\\b`, 'i').test(text)) {
      return value
    }
  }

  const vagueDurations: Array<[RegExp, number]> = [
    [/\ba few seconds\b/i, 4],
    [/\ba couple seconds\b/i, 2],
    [/\ba couple of seconds\b/i, 2],
    [/\ba moment\b/i, 2],
    [/\ba few moments\b/i, 5],
    [/\ba couple moments\b/i, 3],
    [/\ba couple of moments\b/i, 3],
    [/\ba beat\b/i, 1],
    [/\beternity\b/i, 20],
  ]

  for (const [pattern, value] of vagueDurations) {
    if (pattern.test(text)) {
      return value
    }
  }

  return null
}

function resolveCountHintFromCount(explicitCount: number | null): SemanticBeat['countHint'] {
  if (explicitCount == null) return 'unknown'
  if (explicitCount <= 1) return 'one_shot'
  if (explicitCount <= 4) return 'few'
  if (explicitCount <= 20) return 'repeated'
  return 'continuous'
}

function resolveDurationMsFromCount(
  actionType: ActionType,
  explicitCount: number | null,
  clause: string,
): number | null {
  if (explicitCount == null) return null

  const normalized = clause.toLowerCase()
  const deliberateMultiplier =
    /\b(slow|slowly|deliberate|deliberately|firm|deep|bottoming out|flush)\b/i.test(normalized)
      ? 1.35
      : 1

  const basePerCycleMs =
    actionType === 'thrust'
      ? 700
      : actionType === 'stroke'
        ? 600
        : actionType === 'suction'
          ? 850
          : actionType === 'lick'
            ? 750
            : actionType === 'grind'
              ? 900
              : 700

  return Math.max(1200, Math.round(explicitCount * basePerCycleMs * deliberateMultiplier))
}

function hasExplicitPauseCue(text: string): boolean {
  return /\b(pause|pauses|paused|pausing|holds still|holds herself still|holds himself still|goes still|stills|stops moving|waits a beat|for a beat)\b/i.test(
    text,
  )
}

function hasDiscreteActCue(text: string): boolean {
  return /\b(once|single|briefly|just long enough|quick(?:ly)?|one quick|one deep|one firm|one slow)\b/i.test(
    text,
  )
}

function hasBoundedRepeatedCue(text: string): boolean {
  return /\b(a few|a couple|several)\b/i.test(text)
}

function inferDeterministicDurationProfile(
  actionType: ActionType,
  clause: string,
): {
  durationMs: number
  durationClass: SemanticBeat['durationClass']
  countHint: SemanticBeat['countHint']
  persistence: string
  fallbackBehavior: SemanticBeat['fallbackBehavior']
} {
  const normalized = clause.toLowerCase()
  const explicitDurationSeconds = parseExplicitDurationSeconds(clause)
  const explicitCount = parseExplicitCountHint(clause)
  const explicitPause = hasExplicitPauseCue(clause)
  const discreteAct = hasDiscreteActCue(clause)
  const boundedRepeated = hasBoundedRepeatedCue(clause)

  if (explicitPause) {
    const durationMs = explicitDurationSeconds != null ? explicitDurationSeconds * 1000 : 1500
    return {
      durationMs,
      durationClass: resolveDurationClassFromMs(durationMs),
      countHint: 'one_shot',
      persistence: 'brief',
      fallbackBehavior: 'resume_previous',
    }
  }

  if (explicitDurationSeconds != null) {
    const durationMs = explicitDurationSeconds * 1000
    return {
      durationMs,
      durationClass: resolveDurationClassFromMs(durationMs),
      countHint: explicitCount != null ? resolveCountHintFromCount(explicitCount) : 'unknown',
      persistence: durationMs >= 12000 ? 'ongoing' : durationMs >= 4000 ? 'sustained' : 'brief',
      fallbackBehavior: durationMs >= 12000 ? 'hold_last' : 'resume_previous',
    }
  }

  if (explicitCount != null) {
    const durationMs = resolveDurationMsFromCount(actionType, explicitCount, clause) ?? 2500
    return {
      durationMs,
      durationClass: resolveDurationClassFromMs(durationMs),
      countHint: resolveCountHintFromCount(explicitCount),
      persistence: durationMs >= 10000 ? 'ongoing' : 'brief',
      fallbackBehavior: durationMs >= 10000 ? 'hold_last' : 'resume_previous',
    }
  }

  if (discreteAct) {
    const durationMs = /\b(single|once|one)\b/i.test(normalized) ? 1200 : 1800
    return {
      durationMs,
      durationClass: resolveDurationClassFromMs(durationMs),
      countHint: 'one_shot',
      persistence: 'brief',
      fallbackBehavior: 'resume_previous',
    }
  }

  if (boundedRepeated) {
    const durationMs = 4500
    return {
      durationMs,
      durationClass: resolveDurationClassFromMs(durationMs),
      countHint: 'few',
      persistence: 'brief',
      fallbackBehavior: 'resume_previous',
    }
  }

  return {
    durationMs: 12000,
    durationClass: 'ongoing',
    countHint: 'continuous',
    persistence: 'ongoing',
    fallbackBehavior: 'hold_last',
  }
}

function normalizeContinuityVerdict(value: unknown): MessagePlan['continuityVerdict'] {
  return value === 'continue' ||
    value === 'progress' ||
    value === 'modify' ||
    value === 'replace' ||
    value === 'stop'
    ? value
    : null
}

function normalizeActionType(value: unknown): ActionType {
  return value === 'tease' ||
    value === 'stroke' ||
    value === 'thrust' ||
    value === 'suction' ||
    value === 'grind' ||
    value === 'pulse' ||
    value === 'lick' ||
    value === 'squeeze' ||
    value === 'pause'
    ? value
    : 'tease'
}

function normalizeDurationClass(value: unknown): SemanticBeat['durationClass'] {
  return value === 'instant' ||
    value === 'very_short' ||
    value === 'short' ||
    value === 'medium' ||
    value === 'long' ||
    value === 'extended' ||
    value === 'ongoing'
    ? value
    : 'medium'
}

function normalizeTransitionStyle(value: unknown): SemanticBeat['transitionStyle'] {
  return value === 'ramp' ||
    value === 'snap' ||
    value === 'pulse' ||
    value === 'fade' ||
    value === 'steady' ||
    value === 'unknown'
    ? value
    : 'unknown'
}

function normalizeCountHint(value: unknown): SemanticBeat['countHint'] {
  return value === 'one_shot' ||
    value === 'few' ||
    value === 'repeated' ||
    value === 'continuous' ||
    value === 'unknown'
    ? value
    : 'unknown'
}

function normalizeFallbackBehavior(value: unknown): SemanticBeat['fallbackBehavior'] {
  return value === 'resume_previous' ||
    value === 'idle' ||
    value === 'hold_last' ||
    value === 'clear' ||
    value === 'unknown'
    ? value
    : 'unknown'
}

function normalizeResponseMode(value: unknown): SemanticBeat['responseMode'] {
  return value === 'lead' || value === 'meet' || value === 'withdraw' || value === 'mutual'
    ? value
    : 'lead'
}

function normalizeBeatWeights(actorWeight: number, acteeWeight: number) {
  const clampedActorWeight = clamp(actorWeight, 0, 1)
  const clampedActeeWeight = clamp(acteeWeight, 0, 1)
  const total = clampedActorWeight + clampedActeeWeight

  if (total <= 0) {
    return { actorWeight: 0.5, acteeWeight: 0.5 }
  }

  return {
    actorWeight: Number((clampedActorWeight / total).toFixed(4)),
    acteeWeight: Number((clampedActeeWeight / total).toFixed(4)),
  }
}

function inferDeterministicResponseMode(clause: string, fullContent: string): SemanticBeat['responseMode'] {
  const normalizedClause = clause.toLowerCase()
  const normalizedContent = fullContent.toLowerCase()
  const combined = `${normalizedClause} ${normalizedContent}`

  if (
    /\b(withdraw|withdraws|pulls back|pull away|pulls away|shies|shy away|retreats|hesitates|resists|tense(?:s|d)? away|goes still)\b/i.test(
      combined,
    )
  ) {
    return 'withdraw'
  }

  if (
    /\b(counterpoint|in counterpoint|together|simultaneously|at the same time|without speaking|in rhythm|their rhythm|trade between|trading between|one rising as the other descends|both of you|both work|unbroken circuit|work her simultaneously|never leaving your skin|building a rhythm)\b/i.test(
      combined,
    )
  ) {
    return 'mutual'
  }

  if (
    /\b(meet(?:ing|s)?|meeting|press(?:es|ing)? back|bucks? against|chasing the pressure|takes more|take more|holds there|working around you|swallows around you|grip(?:s|ping)? your thighs|jaw stretches|greedy|demanding|takes you deep|take you deep|throat opening|opens to accommodate|mouth replaces|replaces her without hesitation)\b/i.test(
      combined,
    )
  ) {
    return 'meet'
  }

  return 'lead'
}

function inferDeterministicBeatWeights(
  responseMode: SemanticBeat['responseMode'],
): { actorWeight: number; acteeWeight: number } {
  switch (responseMode) {
    case 'mutual':
      return { actorWeight: 0.5, acteeWeight: 0.5 }
    case 'meet':
      return { actorWeight: 0.55, acteeWeight: 0.45 }
    case 'withdraw':
      return { actorWeight: 0.78, acteeWeight: 0.22 }
    case 'lead':
    default:
      return { actorWeight: 0.68, acteeWeight: 0.32 }
  }
}

function resolveCombinedResponseFactors(semanticBeat: SemanticBeat) {
  const closeness = 1 - Math.abs(semanticBeat.actorWeight - semanticBeat.acteeWeight)

  switch (semanticBeat.responseMode) {
    case 'meet': {
      const amplitudeFactor =
        (semanticBeat.actorWeight + semanticBeat.acteeWeight * 1.28) * (1 + closeness * 0.05)
      const tempoFactor =
        (semanticBeat.actorWeight + semanticBeat.acteeWeight * 1.34) * (1 + closeness * 0.08)
      return { amplitudeFactor, tempoFactor }
    }
    case 'mutual': {
      const amplitudeFactor =
        (semanticBeat.actorWeight + semanticBeat.acteeWeight * 1.42) * (1 + closeness * 0.08)
      const tempoFactor =
        (semanticBeat.actorWeight + semanticBeat.acteeWeight * 1.48) * (1 + closeness * 0.12)
      return { amplitudeFactor, tempoFactor }
    }
    case 'withdraw': {
      const amplitudeFactor =
        (semanticBeat.actorWeight + semanticBeat.acteeWeight * 0.58) * (1 - closeness * 0.02)
      const tempoFactor =
        (semanticBeat.actorWeight + semanticBeat.acteeWeight * 0.42) * (1 - closeness * 0.06)
      return { amplitudeFactor, tempoFactor }
    }
    case 'lead':
    default: {
      const amplitudeFactor =
        (semanticBeat.actorWeight + semanticBeat.acteeWeight * 1.08) * (1 + closeness * 0.01)
      const tempoFactor =
        (semanticBeat.actorWeight + semanticBeat.acteeWeight * 1.05) * (1 + closeness * 0.01)
      return { amplitudeFactor, tempoFactor }
    }
  }
}

function buildParticipantProfileIndex(
  participantProfiles: ParticipantProfileBundle,
): Map<string, ParticipantProfile> {
  const index = new Map<string, ParticipantProfile>()

  if (participantProfiles.userProfile) {
    index.set(
      `${participantProfiles.userProfile.participantKind}:${participantProfiles.userProfile.participantId}`,
      participantProfiles.userProfile,
    )
  }

  for (const profile of participantProfiles.characterProfiles) {
    index.set(`${profile.participantKind}:${profile.participantId}`, profile)
  }

  return index
}

function resolveEffectiveMechanicalAxes(profile: ParticipantProfile | null): MechanicalAxes {
  if (!profile) {
    return { ...DEFAULT_MECHANICAL_AXES }
  }

  return {
    baselineStrengthBias: clamp(
      profile.mechanicalAxes.baselineStrengthBias + (profile.userOverrides.baselineStrengthBias ?? 0),
      -100,
      100,
    ),
    baselineTempoBias: clamp(
      profile.mechanicalAxes.baselineTempoBias + (profile.userOverrides.baselineTempoBias ?? 0),
      -100,
      100,
    ),
    rampAggression: clamp(
      profile.mechanicalAxes.rampAggression + (profile.userOverrides.rampAggression ?? 0),
      -100,
      100,
    ),
    motionWeight: clamp(
      profile.mechanicalAxes.motionWeight + (profile.userOverrides.motionWeight ?? 0),
      -100,
      100,
    ),
    endurance: clamp(
      profile.mechanicalAxes.endurance + (profile.userOverrides.endurance ?? 0),
      -100,
      100,
    ),
    smoothness: clamp(
      profile.mechanicalAxes.smoothness + (profile.userOverrides.smoothness ?? 0),
      -100,
      100,
    ),
    dominancePressure: clamp(
      profile.mechanicalAxes.dominancePressure + (profile.userOverrides.dominancePressure ?? 0),
      -100,
      100,
    ),
    teasingTendency: clamp(
      profile.mechanicalAxes.teasingTendency + (profile.userOverrides.teasingTendency ?? 0),
      -100,
      100,
    ),
  }
}

function getProfileKey(
  participantKind: ParticipantKind | null,
  participantId: string | null,
): string | null {
  if (!participantKind || !participantId) return null
  return `${participantKind}:${participantId}`
}

function computeParticipantContribution(
  assignment: ParticipantStateAssignment,
  profile: ParticipantProfile | null,
): {
  amplitudeFactor: number
  tempoFactor: number
  durationFactor: number
} {
  const axes = resolveEffectiveMechanicalAxes(profile)
  const arousalOffset = (assignment.state.arousal - 50) / 50
  const energyOffset = (assignment.state.energy - 50) / 50
  const steadinessOffset = (assignment.state.steadiness - 50) / 50
  const focusOffset = (assignment.state.focus - 50) / 50

  const amplitudeBias =
    axes.baselineStrengthBias * 0.0018 +
    axes.motionWeight * 0.0012 +
    axes.dominancePressure * 0.0015 +
    axes.rampAggression * 0.001 +
    arousalOffset * 0.18 +
    energyOffset * 0.08 +
    steadinessOffset * 0.04

  const tempoBias =
    axes.baselineTempoBias * 0.0018 +
    axes.smoothness * 0.0008 +
    axes.teasingTendency * 0.001 +
    energyOffset * 0.18 +
    focusOffset * 0.08 +
    arousalOffset * 0.06 -
    Math.max(0, -steadinessOffset) * 0.05

  const durationBias =
    axes.endurance * 0.0015 +
    axes.teasingTendency * 0.0008 +
    axes.smoothness * 0.0006 +
    arousalOffset * 0.06 +
    energyOffset * 0.04 +
    focusOffset * 0.03

  return {
    amplitudeFactor: clamp(1 + amplitudeBias, 0.7, 1.4),
    tempoFactor: clamp(1 + tempoBias, 0.7, 1.4),
    durationFactor: clamp(1 + durationBias, 0.8, 1.35),
  }
}

function blendSideContributions(
  assignments: ParticipantStateAssignment[],
  profileIndex: Map<string, ParticipantProfile>,
): {
  amplitudeFactor: number
  tempoFactor: number
  durationFactor: number
} {
  if (assignments.length === 0) {
    return { amplitudeFactor: 1, tempoFactor: 1, durationFactor: 1 }
  }

  let totalWeight = 0
  let amplitude = 0
  let tempo = 0
  let duration = 0

  for (const assignment of assignments) {
    const weight = assignment.weight > 0 ? assignment.weight : 1
    totalWeight += weight
    const profile = profileIndex.get(
      getProfileKey(assignment.participantKind, assignment.participantId) ?? '',
    ) ?? null
    const contribution = computeParticipantContribution(assignment, profile)
    amplitude += contribution.amplitudeFactor * weight
    tempo += contribution.tempoFactor * weight
    duration += contribution.durationFactor * weight
  }

  if (totalWeight <= 0) {
    return { amplitudeFactor: 1, tempoFactor: 1, durationFactor: 1 }
  }

  return {
    amplitudeFactor: amplitude / totalWeight,
    tempoFactor: tempo / totalWeight,
    durationFactor: duration / totalWeight,
  }
}

function resolveParticipantContributionFactors(
  semanticBeat: SemanticBeat,
  participantStates: ParticipantStateAssignment[],
  participantProfiles: ParticipantProfileBundle,
) {
  const profileIndex = buildParticipantProfileIndex(participantProfiles)
  const actorAssignments = participantStates.filter((assignment) => assignment.side === 'actor')
  const acteeAssignments = participantStates.filter((assignment) => assignment.side === 'actee')
  const actorContribution = blendSideContributions(actorAssignments, profileIndex)
  const acteeContribution = blendSideContributions(acteeAssignments, profileIndex)

  return {
    amplitudeFactor: clamp(
      actorContribution.amplitudeFactor * semanticBeat.actorWeight +
        acteeContribution.amplitudeFactor * semanticBeat.acteeWeight,
      0.75,
      1.35,
    ),
    tempoFactor: clamp(
      actorContribution.tempoFactor * semanticBeat.actorWeight +
        acteeContribution.tempoFactor * semanticBeat.acteeWeight,
      0.75,
      1.35,
    ),
    durationFactor: clamp(
      actorContribution.durationFactor * semanticBeat.actorWeight +
        acteeContribution.durationFactor * semanticBeat.acteeWeight,
      0.85,
      1.3,
    ),
  }
}

function resolveCalibratedAxisBase(
  semanticValue: number,
  presetBase: number,
): number {
  return clamp(Math.round(presetBase + (semanticValue - 50)), 0, 100)
}

function resolvePresetForActionType(
  actionType: ActionType,
  settings: UserSettings,
): ActionCalibrationPreset | null {
  const presetsByType = new Map<ActionType, ActionCalibrationPreset>(
    settings.actionCalibrationPresets.map((preset) => [preset.semanticActionType, preset]),
  )
  const visited = new Set<ActionType>()
  let current: ActionType | null = actionType

  while (current && !visited.has(current)) {
    visited.add(current)
    const preset: ActionCalibrationPreset | null = presetsByType.get(current) ?? null
    if (preset?.supported) {
      return preset
    }
    current = preset?.fallbackTarget ?? null
  }

  return settings.actionCalibrationPresets.find((preset) => preset.supported) ?? null
}

function resolveMappingForActionType(
  actionType: ActionType,
  settings: UserSettings,
  fallbackPreset: ActionCalibrationPreset | null,
): XToysActionMappingSettings | null {
  const mappingsByType = new Map<ActionType, XToysActionMappingSettings>(
    settings.xtoysActionMappings.map((mapping) => [mapping.semanticActionType, mapping]),
  )
  const visited = new Set<ActionType>()
  let current: ActionType | null = actionType

  while (current && !visited.has(current)) {
    visited.add(current)
    const mapping = mappingsByType.get(current) ?? null
    if (mapping?.supported && (mapping.xtoysActionName || mapping.fallbackActionName)) {
      return mapping
    }
    const fallbackPresetForType =
      settings.actionCalibrationPresets.find((preset) => preset.semanticActionType === current) ?? null
    current = fallbackPresetForType?.fallbackTarget ?? null
  }

  if (fallbackPreset) {
    return mappingsByType.get(fallbackPreset.semanticActionType) ?? null
  }

  return settings.xtoysActionMappings.find(
    (mapping) => mapping.supported && (mapping.xtoysActionName || mapping.fallbackActionName),
  ) ?? null
}

function sortBeatPayloads(beats: LlmParserBeatPayload[]) {
  return [...beats].sort((left, right) => {
    const leftOrder = typeof left.order_index === 'number' ? left.order_index : Number.MAX_SAFE_INTEGER
    const rightOrder = typeof right.order_index === 'number' ? right.order_index : Number.MAX_SAFE_INTEGER

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder
    }

    return 0
  })
}

function matchCharacterProfileByLabel(
  label: string,
  participantProfiles: ParticipantProfileBundle['characterProfiles'],
) {
  const normalizedLabel = label.trim().toLowerCase()
  if (!normalizedLabel) return null

  const exact = participantProfiles.find(
    (profile) => profile.displayName.trim().toLowerCase() === normalizedLabel,
  )
  if (exact) return exact

  return (
    participantProfiles.find((profile) =>
      profile.aliasHints.some(
        (alias) => alias.trim().length >= 2 && normalizedLabel.includes(alias.trim().toLowerCase()),
      ),
    ) ?? null
  )
}

function buildFallbackParticipantAssignments(
  messageId: string,
  content: string,
  participantProfiles: ParticipantProfileBundle,
  chatPreferences: ChatTrackingPreferences,
  primaryUserContactZone: UserContactZone,
  customUserContactZone: string,
): ParticipantStateAssignment[] {
  return buildParticipantStateAssignments(
    messageId,
    content,
    participantProfiles,
    chatPreferences,
    primaryUserContactZone,
    customUserContactZone,
  )
}

function mapLlmParticipantsToAssignments(
  payload: LlmParserScenePayload,
  messageId: string,
  content: string,
  participantProfiles: ParticipantProfileBundle,
  chatPreferences: ChatTrackingPreferences,
  primaryUserContactZone: UserContactZone,
  customUserContactZone: string,
): ParticipantStateAssignment[] {
  if (!payload.relevant) {
    return []
  }

  const fallbackAssignments = buildFallbackParticipantAssignments(
    messageId,
    content,
    participantProfiles,
    chatPreferences,
    primaryUserContactZone,
    customUserContactZone,
  )

  if (!Array.isArray(payload.participants) || payload.participants.length === 0) {
    return fallbackAssignments
  }

  const assignments: ParticipantStateAssignment[] = []
  for (const participant of payload.participants) {
    if (!participant || typeof participant !== 'object') continue

    const side = participant.side === 'actor' || participant.side === 'actee' ? participant.side : 'actor'
    const weight = typeof participant.weight === 'number' ? clamp(participant.weight, 0, 1) : 0
    const label = typeof participant.label === 'string' ? participant.label : side === 'actor' ? 'Actor' : 'Actee'
    const matchedProfile = participant.is_user
      ? participantProfiles.userProfile
      : matchCharacterProfileByLabel(label, participantProfiles.characterProfiles)

    const baseState = createBaselineParticipantState(messageId)
    const statePayload = participant.state ?? {}
    const state: ParticipantState = {
      arousal:
        typeof statePayload.arousal === 'number' ? clamp(statePayload.arousal, 0, 100) : baseState.arousal,
      energy:
        typeof statePayload.energy === 'number' ? clamp(statePayload.energy, 0, 100) : baseState.energy,
      steadiness:
        typeof statePayload.steadiness === 'number'
          ? clamp(statePayload.steadiness, 0, 100)
          : baseState.steadiness,
      focus:
        typeof statePayload.focus === 'number' ? clamp(statePayload.focus, 0, 100) : baseState.focus,
      provenance: statePayload.provenance === 'parsed' ? 'parsed' : 'baseline',
      sourceMessageId: messageId,
    }

    assignments.push({
      participantId: matchedProfile?.participantId ?? null,
      participantKind: matchedProfile?.participantKind ?? (participant.is_user ? 'persona' : 'character'),
      displayName: matchedProfile?.displayName ?? label,
      side,
      weight,
      isUserPersona: Boolean(participant.is_user),
      state,
    })
  }

  return assignments.length > 0 ? assignments : fallbackAssignments
}

async function runStructuredSceneParser(
  userId: string,
  settings: UserSettings,
  chatPreferences: ChatTrackingPreferences,
  selectedContent: string,
  recentContext: Array<{ role: 'user' | 'assistant'; content: string }>,
  participantProfiles: ParticipantProfileBundle,
): Promise<LlmParserScenePayload | null> {
  const connectionId = resolveParserConnectionId(settings)
  const trackedReferenceHints = buildTrackedReferenceHints(participantProfiles, chatPreferences)
  const trackedPossessiveReferenceHints = buildTrackedPossessiveReferenceHints(
    participantProfiles,
    chatPreferences,
  )
  const trackedProfile = resolveTrackedParticipantProfile(participantProfiles, chatPreferences)
  const trackedLabel = trackedProfile?.displayName ?? 'tracked participant'
  const contactZone =
    chatPreferences.primaryContactZone === 'custom'
      ? `custom (${chatPreferences.customContactZone || 'unspecified'})`
      : chatPreferences.primaryContactZone
  const zoneScopedActionHints = extractZoneScopedActionHints(
    selectedContent,
    chatPreferences.primaryContactZone,
    chatPreferences.customContactZone,
    trackedReferenceHints,
    trackedPossessiveReferenceHints,
  )

  const messages: LlmMessageDTO[] = [
    {
      role: 'system',
      content:
        [
          'You parse erotic roleplay text into structured tactile planning data.',
          'Only include beats and participants directly connected to the tracked participant primary contact zone.',
          'If the selected message does not clearly involve that tracked participant contact zone, return relevant=false and no beats.',
          'The tracked contact zone must belong to the tracked participant, not just any participant in the scene.',
          'If multiple simultaneous actions are present, keep only the actions applied to the tracked participant primary contact zone and ignore parallel actions on other body areas.',
          'Infer ordered beats, continuity verdict, participant inclusion, participant sides, participant weights, and current participant states.',
          'Each beat must include transition_style, count_hint, and fallback_behavior.',
          'Each beat must include source_excerpt quoting the exact local phrase or sentence fragment that supports that beat.',
          'If the message gives an explicit time in seconds, convert it directly into duration_ms for that beat.',
          'The continuity verdict should reflect the resulting end state of the whole message, not only the first beat.',
          'Return exactly one tool call to parse_tactile_scene.',
          'Do not narrate. Do not explain.',
        ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Tracked participant: ${trackedLabel}`,
        `Primary tracked contact zone: ${contactZone}`,
        `Tracked zone reference hints: ${trackedReferenceHints.join(', ')}`,
        `Tracked possessive zone anchors: ${trackedPossessiveReferenceHints.join(', ')}`,
        summarizeParticipantProfiles(participantProfiles),
        recentContext.length > 0
          ? `Recent context:\n${recentContext
              .map((entry, index) => `${index + 1}. ${entry.role}: ${entry.content}`)
              .join('\n')}`
          : 'Recent context: none',
        zoneScopedActionHints.length > 0
          ? `Zone-scoped local action hints near the tracked participant zone: ${zoneScopedActionHints.join(', ')}`
          : 'Zone-scoped local action hints near the tracked participant zone: none',
        `Selected assistant message:\n${selectedContent}`,
      ].join('\n\n'),
    },
  ]

  let doneChunk:
    | {
        type: 'done'
        content: string
        finish_reason: string
        tool_calls?: Array<{ name: string; args: Record<string, unknown> }>
      }
    | null = null

  for await (const chunk of spindle.generate.rawStream({
    type: 'raw',
    messages,
    connection_id: connectionId,
    tools: [PARSE_SCENE_TOOL],
    reasoning: { source: 'off' },
    userId,
  })) {
    if (chunk.type === 'done') {
      doneChunk = chunk
    }
  }

  if (!doneChunk) {
    return null
  }

  const toolCall = doneChunk.tool_calls?.find((call) => call.name === PARSE_SCENE_TOOL.name)
  if (!toolCall) {
    return null
  }

  const args = toolCall.args as Partial<LlmParserScenePayload>
  if (typeof args.relevant !== 'boolean' || !Array.isArray(args.participants) || !Array.isArray(args.beats)) {
    return null
  }

  return {
    relevant: args.relevant,
    continuity_verdict: normalizeContinuityVerdict(args.continuity_verdict),
    participants: args.participants as LlmParserParticipantPayload[],
    beats: args.beats as LlmParserBeatPayload[],
  }
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

function createBaselineParticipantState(messageId: string): ParticipantState {
  return {
    arousal: 50,
    energy: 50,
    steadiness: 50,
    focus: 50,
    provenance: 'baseline',
    sourceMessageId: messageId,
  }
}

function detectActionType(content: string): ActionType {
  const normalized = content.toLowerCase()

  if (
    /\b(your\s+(cock|dick|penis|shaft)|cock|dick|penis|shaft)\b[^.!?]{0,40}\b(parts?|push(?:es|ing)?|press(?:es|ing)?|slides?|sliding|sinks?|sinking|buries?|enter(?:s|ing)?|disappears?|fill(?:s|ing)?|seat(?:s|ed|ing)?|hilt)\b/i.test(
      normalized,
    ) ||
    /\b(to the hilt|sink deeper|shaft disappears into|slides past|past the ring of|inside her|inside him|inside them)\b/i.test(
      normalized,
    )
  ) {
    return 'thrust'
  }
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

function detectDurationMs(content: string, actionTypeOverride?: ActionType | null): number {
  const normalized = content.toLowerCase()
  const explicitDurationSeconds = parseExplicitDurationSeconds(content)
  if (explicitDurationSeconds != null) {
    return explicitDurationSeconds * 1000
  }

  const explicitCount = parseExplicitCountHint(content)
  const actionType = actionTypeOverride ?? detectActionType(content)
  const countedDurationMs = resolveDurationMsFromCount(actionType, explicitCount, content)
  if (countedDurationMs != null) {
    return countedDurationMs
  }

  if (hasExplicitPauseCue(content)) return 1500
  if (hasDiscreteActCue(content)) return 1500
  if (hasBoundedRepeatedCue(content)) return 4500
  if (/(long|linger|lingering|lasting|prolonged)\b/.test(normalized)) return 6500
  if (/(continue|keeps|keeping|still|ongoing|buried|inside|flush against|to the hilt|don['’]t stop)\b/.test(normalized)) return 12000
  return 12000
}

function detectDurationClass(content: string, actionTypeOverride?: ActionType | null): SemanticBeat['durationClass'] {
  const normalized = content.toLowerCase()

  if (hasExplicitPauseCue(content)) return 'very_short'
  if (hasDiscreteActCue(content)) return /\b(single|once|one)\b/.test(normalized) ? 'instant' : 'very_short'
  if (parseExplicitDurationSeconds(content) != null) {
    return resolveDurationClassFromMs(parseExplicitDurationSeconds(content)! * 1000)
  }
  if (parseExplicitCountHint(content) != null) {
    const durationMs = resolveDurationMsFromCount(
      actionTypeOverride ?? detectActionType(content),
      parseExplicitCountHint(content),
      content,
    )
    return resolveDurationClassFromMs(durationMs ?? 4500)
  }
  if (hasBoundedRepeatedCue(content)) return 'medium'
  if (/(long|linger|lingering|lasting|prolonged)\b/.test(normalized)) return 'long'
  if (/(continue|keeps|keeping|still|ongoing|buried|inside|flush against|to the hilt|don['’]t stop)\b/.test(normalized)) return 'ongoing'
  return 'ongoing'
}

function detectPersistence(
  content: string,
  preset: ActionCalibrationPreset,
  playbackModeOverride: PlaybackMode | null,
): string {
  const normalized = content.toLowerCase()

  if (/(pulls away|stops|withdraws|lets go|breaks contact)\b/.test(normalized)) return 'stop'
  if (hasExplicitPauseCue(content)) return 'brief'
  if (hasDiscreteActCue(content)) return 'instant'
  if (parseExplicitDurationSeconds(content) != null || parseExplicitCountHint(content) != null || hasBoundedRepeatedCue(content)) {
    return 'brief'
  }
  if (/(continue|keeps|keeping|still|ongoing|buried|inside|flush against|to the hilt|don['’]t stop|works|working|lingers|latching|stays on)\b/.test(normalized)) return 'ongoing'
  const effectiveMode = playbackModeOverride ?? preset.repeatStyle
  if (effectiveMode === 'hold') return 'sustained'
  if (effectiveMode === 'loop') return 'ongoing'
  return 'ongoing'
}

function applyParticipantStateCue(
  state: ParticipantState,
  matched: { arousal?: number; energy?: number; steadiness?: number; focus?: number },
) {
  if (matched.arousal != null) state.arousal = clamp(state.arousal + matched.arousal, 0, 100)
  if (matched.energy != null) state.energy = clamp(state.energy + matched.energy, 0, 100)
  if (matched.steadiness != null) state.steadiness = clamp(state.steadiness + matched.steadiness, 0, 100)
  if (matched.focus != null) state.focus = clamp(state.focus + matched.focus, 0, 100)
}

function detectParticipantState(
  content: string,
  messageId: string,
  role: 'actor' | 'actee',
): ParticipantState {
  const normalized = content.toLowerCase()
  const state = createBaselineParticipantState(messageId)
  let matched = false

  const roleAnchors =
    role === 'actor'
      ? ['he', 'she', 'they', 'his', 'her', 'their', 'partner', 'man', 'woman']
      : ['you', 'your', 'yours', 'yourself']

  const scopedCue = (
    cuePattern: RegExp,
    values: { arousal?: number; energy?: number; steadiness?: number; focus?: number },
  ) => {
    const matchedScope = roleAnchors.some((anchor) =>
      new RegExp(`\\b${anchor}\\b[^.!?]{0,28}${cuePattern.source}|${cuePattern.source}[^.!?]{0,28}\\b${anchor}\\b`, 'i').test(
        normalized,
      ),
    )

    if (matchedScope) {
      matched = true
      applyParticipantStateCue(state, values)
    }
  }

  scopedCue(/\b(aroused|needy|desperate|hungry|aching|worked up|heated)\b/i, {
    arousal: 22,
    focus: 8,
  })
  scopedCue(/\b(tired|exhausted|drained|spent|sedated|weary)\b/i, {
    energy: -25,
    steadiness: -10,
  })
  scopedCue(/\b(well-rested|rested|steady|composed|collected)\b/i, {
    energy: 18,
    steadiness: 12,
  })
  scopedCue(/\b(shaky|trembling|tremble|quivering|unsteady)\b/i, {
    steadiness: -24,
    arousal: 10,
  })
  scopedCue(/\b(focused|intent|locked in|attentive|careful)\b/i, {
    focus: 22,
  })
  scopedCue(/\b(overwhelmed|dazed|dizzy|foggy|overstimulated)\b/i, {
    focus: -22,
    steadiness: -10,
  })

  if (!matched) {
    const genericCueMap: Array<
      [RegExp, { arousal?: number; energy?: number; steadiness?: number; focus?: number }]
    > = [
      [/\b(aroused|needy|desperate|hungry|aching|worked up|heated)\b/i, { arousal: 16, focus: 6 }],
      [/\b(tired|exhausted|drained|spent|sedated|weary)\b/i, { energy: -18, steadiness: -8 }],
      [/\b(well-rested|rested|steady|composed|collected)\b/i, { energy: 12, steadiness: 10 }],
      [/\b(shaky|trembling|tremble|quivering|unsteady)\b/i, { steadiness: -18, arousal: 8 }],
      [/\b(focused|intent|locked in|attentive|careful)\b/i, { focus: 16 }],
      [/\b(overwhelmed|dazed|dizzy|foggy|overstimulated)\b/i, { focus: -18, steadiness: -8 }],
    ]

    for (const [pattern, values] of genericCueMap) {
      if (pattern.test(normalized)) {
        matched = true
        applyParticipantStateCue(state, values)
      }
    }
  }

  if (matched) {
    state.provenance = 'parsed'
  }

  return state
}

function inferUserLikelySide(content: string): 'actor' | 'actee' {
  const normalized = content.toLowerCase()

  if (
    /\byou\b[^.!?]{0,24}\b(thrust|stroke|grind|lick|suck|ride|press|fuck|tease|rub|kiss|slide)\b/i.test(
      normalized,
    )
  ) {
    return 'actor'
  }

  if (
    /\b(into|against|on|over|beneath|inside|toward)\s+you\b|\byour\b/i.test(normalized)
  ) {
    return 'actee'
  }

  return 'actee'
}

function inferTrackedParticipantLikelySide(content: string, trackedReferences: string[]): 'actor' | 'actee' {
  const normalized = content.toLowerCase()

  for (const reference of trackedReferences) {
    const escaped = escapeRegExp(reference.toLowerCase())

    if (
      new RegExp(
        `\\b${escaped}\\b[^.!?]{0,28}\\b(thrust|stroke|grind|lick|suck|ride|press|fuck|tease|rub|kiss|slide|swallow|take)\\b`,
        'i',
      ).test(normalized)
    ) {
      return 'actor'
    }

    if (
      new RegExp(`\\b(into|against|on|over|beneath|inside|toward)\\s+${escaped}\\b`, 'i').test(normalized)
    ) {
      return 'actee'
    }
  }

  return inferUserLikelySide(content)
}

function buildCustomZonePattern(customZone: string): RegExp {
  const terms = customZone
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  if (terms.length === 0) {
    return /\b(genitals)\b/
  }

  return new RegExp(`\\b(${terms.join('|')})\\b`)
}

function getUserZoneTerms(zone: UserContactZone, customZone: string): RegExp {
  switch (zone) {
    case 'anus':
      return /\b(anus|asshole|hole|rear|backdoor)\b/
    case 'mouth':
      return /\b(mouth|lips|tongue|throat)\b/
    case 'custom':
      return buildCustomZonePattern(customZone)
    case 'genitals':
    default:
      return /\b(cock|dick|clit|clitoris|pussy|cunt|vagina|penis|shaft|tip|entrance|length|underside|ridge)\b/
  }
}

function containsAnyReference(text: string, references: string[]): boolean {
  const normalized = text.toLowerCase()
  return references.some((reference) => {
    const escaped = escapeRegExp(reference.toLowerCase())
    return new RegExp(`\\b${escaped}\\b`, 'i').test(normalized)
  })
}

function containsUserOwnedZoneReference(
  text: string,
  zone: UserContactZone,
  customZone: string,
  possessiveReferences: string[],
): boolean {
  const normalized = text.toLowerCase()
  const zoneTerms = getUserZoneTerms(zone, customZone)
  const zonePattern = new RegExp(zoneTerms.source, 'gi')

  for (const match of normalized.matchAll(zonePattern)) {
    const matchIndex = match.index ?? 0
    const start = Math.max(0, matchIndex - 40)
    const end = Math.min(normalized.length, matchIndex + match[0].length + 24)
    const localWindow = normalized.slice(start, end)
    const zoneOffset = matchIndex - start

    const hasPossessiveReference = possessiveReferences.some((reference) => {
      const escaped = escapeRegExp(reference.toLowerCase())
      const ownedZonePattern = new RegExp(`\\b${escaped}\\b(?:\\s+\\w+){0,2}\\s+\\b${escapeRegExp(match[0].toLowerCase())}\\b`, 'i')
      if (ownedZonePattern.test(localWindow)) {
        return true
      }

      if (zone === 'genitals' || zone === 'custom') {
        return new RegExp(`\\b${escaped}\\b`, 'i').test(localWindow)
      }

      const prefixWindow = localWindow.slice(Math.max(0, zoneOffset - 22), Math.min(localWindow.length, zoneOffset + match[0].length))
      return new RegExp(`\\b${escaped}\\b(?:\\s+\\w+){0,1}\\s+\\b${escapeRegExp(match[0].toLowerCase())}\\b`, 'i').test(prefixWindow)
    })

    if (hasPossessiveReference) {
      return true
    }
  }

  return false
}

function hasExplicitNonGenitalPenetratorObject(text: string): boolean {
  return /\b(finger|fingers|hand|hands|toy|dildo|strap|strapon|strap-on|plug|object)\b/i.test(text)
}

function containsActorGenitalPenetration(
  text: string,
  zone: UserContactZone,
  userReferences: string[],
): boolean {
  if (zone !== 'genitals') {
    return false
  }

  const normalized = text.toLowerCase()
  const actorReferencePattern =
    userReferences.length > 0
      ? new RegExp(
          `\\b(${userReferences
            .map((reference) => escapeRegExp(reference.toLowerCase()))
            .join('|')})\\b`,
          'i',
        )
      : /\b(you|your|yours|yourself)\b/i

  if (!actorReferencePattern.test(normalized)) {
    return false
  }

  if (hasExplicitNonGenitalPenetratorObject(normalized)) {
    return false
  }

  return (
    /\b(press(?:es|ing)?|push(?:es|ing)?|slide(?:s|ing)?|thrust(?:s|ing)?|sink(?:s|ing)?|bury|buries|enter(?:s|ing)?|penetrat(?:e|es|ing)|fuck(?:s|ing)?)\b[^.!?]{0,36}\b(into|inside|in)\b[^.!?]{0,24}\b(her|him|them|body|hole|pussy|cunt|ass|anus|mouth|throat)\b/i.test(
      normalized,
    ) ||
    /\b(your\s+(cock|dick|penis|shaft)|cock|dick|penis|shaft)\b[^.!?]{0,50}\b(parts?|push(?:es|ing)?|press(?:es|ing)?|slides?|sliding|sinks?|sinking|buries?|enter(?:s|ing)?|disappears?|fill(?:s|ing)?|seat(?:s|ed|ing)?)\b/i.test(
      normalized,
    ) ||
    /\b(to the hilt|sink deeper|shaft disappears into|slides past|past the ring of|seated inside her|seated inside him|seated deep inside)\b/i.test(
      normalized,
    )
  )
}

function containsPenetrationIntoOwnedZone(
  text: string,
  zone: UserContactZone,
  customZone: string,
  possessiveReferences: string[],
  trackedReferences: string[] = [],
): boolean {
  const normalized = text.toLowerCase()
  const zoneTerms = getUserZoneTerms(zone, customZone)
  const zonePattern = new RegExp(zoneTerms.source, 'gi')
  const penetrationPattern =
    /\b(press(?:es|ing)?|push(?:es|ing)?|slide(?:s|ing)?|thrust(?:s|ing)?|sink(?:s|ing)?|bury|buries|enter(?:s|ing)?|penetrat(?:e|es|ing)|fuck(?:s|ing)?|fill(?:s|ing)?|stretch(?:es|ing)?)\b/i

  if (!penetrationPattern.test(normalized)) {
    return false
  }

  for (const reference of trackedReferences) {
    const escapedReference = escapeRegExp(reference.toLowerCase())

    if (
      new RegExp(
        `\\b(press(?:es|ing)?|push(?:es|ing)?|slide(?:s|ing)?|thrust(?:s|ing)?|sink(?:s|ing)?|bury|buries|enter(?:s|ing)?|penetrat(?:e|es|ing)|fuck(?:s|ing)?|fill(?:s|ing)?|stretch(?:es|ing)?)\\b[^.!?]{0,40}\\b(into|inside|in)\\b[^.!?]{0,24}\\b${escapedReference}\\b`,
        'i',
      ).test(normalized)
    ) {
      return true
    }

    if (
      new RegExp(
        `\\b${escapedReference}(?:'s)?\\b[^.!?]{0,36}\\b(heat|entrance|folds|walls|rim|depths?|hole|body|inside|slick\\s+heat|wet\\s+heat)\\b`,
        'i',
      ).test(normalized)
    ) {
      return true
    }
  }

  for (const match of normalized.matchAll(zonePattern)) {
    const matchIndex = match.index ?? 0
    const start = Math.max(0, matchIndex - 40)
    const end = Math.min(normalized.length, matchIndex + match[0].length + 40)
    const localWindow = normalized.slice(start, end)

    const hasPossessiveReference = possessiveReferences.some((reference) => {
      const escaped = escapeRegExp(reference.toLowerCase())
      return new RegExp(`\\b${escaped}\\b`, 'i').test(localWindow)
    })

    if (hasPossessiveReference && penetrationPattern.test(localWindow)) {
      return true
    }
  }

  return false
}

function collectZoneScopedWindows(
  content: string,
  zone: UserContactZone,
  customZone: string,
  userReferences?: string[],
  possessiveReferences?: string[],
): string[] {
  const normalized = content.toLowerCase()
  const zoneTerms = getUserZoneTerms(zone, customZone)
  const globalPattern = new RegExp(zoneTerms.source, 'gi')
  const windows: string[] = []

  for (const match of normalized.matchAll(globalPattern)) {
    const matchIndex = match.index ?? 0
    const start = Math.max(0, matchIndex - 56)
    const end = Math.min(normalized.length, matchIndex + match[0].length + 56)
    const windowText = normalized.slice(start, end)
    const hasUserReference =
      !userReferences || userReferences.length === 0 || containsAnyReference(windowText, userReferences)
    const hasOwnedZoneReference =
      !possessiveReferences ||
      possessiveReferences.length === 0 ||
      containsUserOwnedZoneReference(windowText, zone, customZone, possessiveReferences)

    if (
      hasUserReference &&
      (hasOwnedZoneReference ||
        containsPenetrationIntoOwnedZone(
          windowText,
          zone,
          customZone,
          possessiveReferences ?? [],
          userReferences ?? [],
        ) ||
        containsActorGenitalPenetration(windowText, zone, userReferences ?? []))
    ) {
      windows.push(windowText)
    }
  }

  return windows
}

function dedupeActionTypes(actionTypes: ActionType[]): ActionType[] {
  return [...new Set(actionTypes)]
}

function rankZoneScopedActionHints(
  content: string,
  zone: UserContactZone,
  customZone: string,
  userReferences?: string[],
  possessiveReferences?: string[],
): Array<{ actionType: ActionType; score: number }> {
  const windows = collectZoneScopedWindows(
    content,
    zone,
    customZone,
    userReferences,
    possessiveReferences,
  )
  const scores = new Map<ActionType, number>()

  const addScore = (actionType: ActionType, amount: number) => {
    scores.set(actionType, (scores.get(actionType) ?? 0) + amount)
  }

  const trackedSide = inferTrackedParticipantLikelySide(content, userReferences ?? [])
  const hasActorPenetration = containsActorGenitalPenetration(content, zone, userReferences ?? [])
  const hasTrackedZonePenetration = containsPenetrationIntoOwnedZone(
    content,
    zone,
    customZone,
    possessiveReferences ?? [],
    userReferences ?? [],
  )

  if (hasActorPenetration || hasTrackedZonePenetration) {
    addScore('thrust', 12)
  }

  if (trackedSide === 'actee' && hasTrackedZonePenetration) {
    addScore('thrust', 10)
    addScore('suction', -9)
    addScore('lick', -7)
    addScore('stroke', -4)
  }

  for (const windowText of windows) {
    const hasMouthCue = /\b(mouth|lips|tongue|throat|oral)\b/i.test(windowText)
    const hasHandCue = /\b(hand|hands|fingers|palm|grip|wrapped|wraps|stroking by hand)\b/i.test(windowText)
    const hasGenitalCue = /\b(cock|dick|penis|shaft|head|tip|length)\b/i.test(windowText)

    if (/\b(suck|sucking|suction)\b/i.test(windowText)) addScore('suction', 5)
    if (/\b(takes?\s+(him|it)\s+deep|into\s+(her|his)\s+mouth|throat\s+working)\b/i.test(windowText)) {
      addScore('suction', 6)
    }
    if (hasMouthCue && hasGenitalCue) {
      addScore('suction', 5)
    }

    if (/\b(tongue|tonguing|lick|licking|lips)\b/i.test(windowText)) addScore('lick', 4)
    if (/\b(mouth)\b/i.test(windowText)) addScore('lick', 2)

    if (/\b(stroke|stroking|pump|pumping)\b/i.test(windowText) && hasHandCue) addScore('stroke', 4)
    if (
      /\b(shaft|hand\s+still\s+wrapped|works?\s+his\s+shaft|wrapped\s+around\s+the\s+base)\b/i.test(
        windowText,
      ) &&
      hasHandCue
    ) {
      addScore('stroke', 5)
    }
    if (hasMouthCue && hasGenitalCue && !hasHandCue) {
      addScore('stroke', -4)
    }

    if (/\b(thrust|thrusting|slide|sliding)\b/i.test(windowText)) addScore('thrust', 3)
    if (
      containsActorGenitalPenetration(windowText, zone, userReferences ?? []) ||
      containsPenetrationIntoOwnedZone(
        windowText,
        zone,
        customZone,
        possessiveReferences ?? [],
        userReferences ?? [],
      )
    ) {
      addScore('thrust', 7)
    }
    if (/\b(grind|grinding|circle|circular|rolling)\b/i.test(windowText)) addScore('grind', 1)
    if (/\b(tease|teasing|trace|tracing)\b/i.test(windowText)) addScore('tease', 2)
    if (/\b(squeeze|squeezing|clench)\b/i.test(windowText)) addScore('squeeze', 2)
    if (/\b(pulse|pulsing|throb|throbbing)\b/i.test(windowText)) addScore('pulse', 2)
  }

  return [...scores.entries()]
    .map(([actionType, score]) => ({ actionType, score }))
    .sort((left, right) => right.score - left.score)
}

function extractZoneScopedActionHints(
  content: string,
  zone: UserContactZone,
  customZone: string,
  userReferences?: string[],
  possessiveReferences?: string[],
): ActionType[] {
  return dedupeActionTypes(
    rankZoneScopedActionHints(content, zone, customZone, userReferences, possessiveReferences).map(
      (entry) => entry.actionType,
    ),
  )
}

function hasEroticActionCue(text: string): boolean {
  return /\b(stroke|strokes|thrust|thrusts|grind|grinds|lick|licks|suck|sucks|suction|ride|rides|press|presses|fuck|fucks|tease|teases|rub|rubs|kiss|kisses|slide|slides|sink|sinks|fill|fills|mouth|tongue|lips|throat|inside|into|buried|clench|pulse|swallow|swallows|cleaning|taste|tasting)\b/i.test(
    text,
  )
}

type ZoneRelevantClause = {
  clause: string
  sentence: string
}

function splitZoneRelevantClauses(
  content: string,
  zone: UserContactZone,
  customZone: string,
  userReferences: string[],
  possessiveReferences: string[],
): ZoneRelevantClause[] {
  const zoneTerms = getUserZoneTerms(zone, customZone)
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  const acceptedClauses: ZoneRelevantClause[] = []

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase()
    const sentenceRelevant =
      containsAnyReference(sentence, userReferences) &&
      ((zoneTerms.test(sentenceLower) &&
        (containsUserOwnedZoneReference(sentence, zone, customZone, possessiveReferences) ||
          containsPenetrationIntoOwnedZone(
            sentence,
            zone,
            customZone,
            possessiveReferences,
            userReferences,
          ))) ||
        containsActorGenitalPenetration(sentence, zone, userReferences))

    if (!sentenceRelevant) {
      continue
    }

    const clauses = sentence
      .split(
        /,\s+|;\s+|\s+[—–-]\s+|(?<=\s)\bas\b\s+|(?<=\s)\bwhile\b\s+|(?<=\s)\bat the same time\b|(?<=\s)\bthen\b\s+/i,
      )
      .map((clause) => clause.trim())
      .filter(Boolean)

    for (const clause of clauses) {
      if (!hasEroticActionCue(clause) && !hasExplicitPauseCue(clause)) {
        continue
      }

      const clauseRelevant =
        containsAnyReference(clause, userReferences) ||
        zoneTerms.test(clause.toLowerCase()) ||
        containsActorGenitalPenetration(clause, zone, userReferences) ||
        containsPenetrationIntoOwnedZone(
          clause,
          zone,
          customZone,
          possessiveReferences,
          userReferences,
        )

      if (clauseRelevant || sentenceRelevant) {
        acceptedClauses.push({ clause, sentence })
      }
    }
  }

  return acceptedClauses
}

function buildClauseActionCueMap(clause: string): Map<ActionType, number> {
  const normalized = clause.toLowerCase()
  const cues = new Map<ActionType, number>()
  const addCue = (actionType: ActionType, amount: number) => {
    cues.set(actionType, Math.max(cues.get(actionType) ?? 0, amount))
  }

  if (
    /\b(stroke|strokes|deep thrust|deep thrusts|thrust|thrusts|pistons?|bottom(?:ing)? out|fill(?:s|ing)? her again|sink(?:s|ing)? back|inside me|inside her|inside him|inside them|to the hilt|buried)\b/i.test(
      normalized,
    )
  ) {
    addCue('thrust', 5)
  }
  if (
    /\b(suck|sucks|suction|mouth|tongue|lips|throat|swallow|swallows|cleaning|taste|tasting)\b/i.test(
      normalized,
    )
  ) {
    addCue('suction', 5)
  }
  if (/\b(lick|licks|tongue tracing|tongue sweeping|tongue darting|tracing)\b/i.test(normalized)) {
    addCue('lick', 4)
  }
  if (/\b(stroke|stroking|hand|hands|fingers|grip|wrapped)\b/i.test(normalized)) {
    addCue('stroke', 4)
  }
  if (/\b(grind|grinds|grinding|circle|circular|rolling)\b/i.test(normalized)) {
    addCue('grind', 3)
  }
  if (/\b(tease|teases|teasing)\b/i.test(normalized)) {
    addCue('tease', 2)
  }
  if (/\b(squeeze|squeezes|squeezing|clench|clenching)\b/i.test(normalized)) {
    addCue('squeeze', 2)
  }
  if (/\b(pulse|pulses|pulsing|throb|throbbing)\b/i.test(normalized)) {
    addCue('pulse', 2)
  }

  return cues
}

function inferActionTypesFromClause(
  clause: string,
  sentence: string,
  zone: UserContactZone,
  customZone: string,
  userReferences: string[],
  possessiveReferences: string[],
): ActionType[] {
  if (hasExplicitPauseCue(clause)) {
    return ['pause']
  }

  const clauseRanked = rankZoneScopedActionHints(
    clause,
    zone,
    customZone,
    userReferences,
    possessiveReferences,
  )
  const cueMap = buildClauseActionCueMap(clause)
  const hintedFromClause = clauseRanked.filter((entry) => entry.score >= 3)
  if (hintedFromClause.length > 0) {
    const topScore = hintedFromClause[0]?.score ?? 0
    return dedupeActionTypes(
      hintedFromClause
        .filter(
          (entry) =>
            entry.score >= Math.max(3, topScore - 2) &&
            (cueMap.has(entry.actionType) || entry.actionType === hintedFromClause[0]?.actionType),
        )
        .map((entry) => entry.actionType),
    )
  }

  const sentenceRanked = rankZoneScopedActionHints(
    sentence,
    zone,
    customZone,
    userReferences,
    possessiveReferences,
  )
  const inheritedActionTypes = sentenceRanked
    .filter((entry) => cueMap.has(entry.actionType))
    .sort((left, right) => (cueMap.get(right.actionType) ?? 0) - (cueMap.get(left.actionType) ?? 0))
    .map((entry) => entry.actionType)

  if (inheritedActionTypes.length > 0) {
    return dedupeActionTypes(inheritedActionTypes)
  }

  const fallbackCueTypes = [...cueMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .filter(([, score]) => score >= 4)
    .map(([actionType]) => actionType)

  if (fallbackCueTypes.length > 0) {
    return dedupeActionTypes(fallbackCueTypes)
  }

  if (
    containsActorGenitalPenetration(clause, zone, userReferences) ||
    containsPenetrationIntoOwnedZone(
      clause,
      zone,
      customZone,
      possessiveReferences,
      userReferences,
    )
  ) {
    return ['thrust']
  }

  return cueMap.has('pause') ? ['pause'] : []
}

function buildDeterministicZoneScopedBeats(
  content: string,
  messageId: string,
  zone: UserContactZone,
  customZone: string,
  userReferences: string[],
  possessiveReferences: string[],
): LlmParserBeatPayload[] {
  const clauses = splitZoneRelevantClauses(
    content,
    zone,
    customZone,
    userReferences,
    possessiveReferences,
  )
  const beats: LlmParserBeatPayload[] = []

  for (const entry of clauses) {
    const actionTypes = inferActionTypesFromClause(
      entry.clause,
      entry.sentence,
      zone,
      customZone,
      userReferences,
      possessiveReferences,
    )
    if (actionTypes.length === 0) continue

    for (const actionType of actionTypes) {
      const normalized = entry.clause.toLowerCase()
      const durationProfile = inferDeterministicDurationProfile(actionType, entry.clause)
      const responseMode = inferDeterministicResponseMode(entry.clause, content)
      const inferredWeights = inferDeterministicBeatWeights(responseMode)

      beats.push({
        order_index: beats.length,
        source_excerpt: entry.clause,
        action_type: actionType,
        strength: /\b(deep|takes him deep|throat|rigid|hard)\b/i.test(normalized) ? 70 : 55,
        frequency: /\b(slow|deliberate|holds|holding)\b/i.test(normalized) ? 35 : 50,
        duration_class: durationProfile.durationClass,
        duration_ms: durationProfile.durationMs,
        transition_style: /\b(slow|deliberate|lowers herself)\b/i.test(normalized) ? 'ramp' : 'steady',
        count_hint: durationProfile.countHint,
        persistence: durationProfile.persistence,
        response_mode: responseMode,
        explicit_change: /\b(again|at the same time|while|then)\b/i.test(normalized),
        explicit_stop: false,
        actor_weight: inferredWeights.actorWeight,
        actee_weight: inferredWeights.acteeWeight,
        fallback_behavior: durationProfile.fallbackBehavior,
      })
    }
  }

  const sceneHasPenetration =
    containsActorGenitalPenetration(content, zone, userReferences) ||
    containsPenetrationIntoOwnedZone(
      content,
      zone,
      customZone,
      possessiveReferences,
      userReferences,
    )

  if (sceneHasPenetration && !beats.some((beat) => beat.action_type === 'thrust')) {
    const penetrationEntry =
      clauses.find(({ clause }) =>
        /\b(stroke|strokes|thrust|thrusts|deep thrust|deep thrusts|pistons?|into\s+\w+|back to\s+\w+|fill(?:s|ing)?\s+\w+|sink(?:s|ing)?\s+back|bottom(?:ing)? out|to the hilt|buried|inside me|inside her|inside him|inside them)\b/i.test(
          clause,
        ),
      ) ?? clauses[0]

    if (penetrationEntry) {
      const normalized = penetrationEntry.clause.toLowerCase()
      const durationProfile = inferDeterministicDurationProfile('thrust', penetrationEntry.clause)
      const responseMode = inferDeterministicResponseMode(penetrationEntry.clause, content)
      const inferredWeights = inferDeterministicBeatWeights(responseMode)

      beats.unshift({
        order_index: 0,
        source_excerpt: penetrationEntry.clause,
        action_type: 'thrust',
        strength: /\b(deep|rigid|hard|bottom(?:ing)? out|to the hilt)\b/i.test(normalized) ? 70 : 55,
        frequency: /\b(slow|deliberate|holds|holding)\b/i.test(normalized) ? 35 : 50,
        duration_class: durationProfile.durationClass,
        duration_ms: durationProfile.durationMs,
        transition_style: /\b(slow|deliberate)\b/i.test(normalized) ? 'ramp' : 'steady',
        count_hint: durationProfile.countHint,
        persistence: durationProfile.persistence,
        response_mode: responseMode,
        explicit_change: /\b(again|at the same time|while|then|back)\b/i.test(normalized),
        explicit_stop: false,
        actor_weight: inferredWeights.actorWeight,
        actee_weight: inferredWeights.acteeWeight,
        fallback_behavior: durationProfile.fallbackBehavior,
      })

      beats.forEach((beat, index) => {
        beat.order_index = index
      })
    }
  }

  return beats
}

function repairParsedSceneToZoneScopedActions(
  parsedScene: LlmParserScenePayload | null,
  content: string,
  zone: UserContactZone,
  customZone: string,
  userReferences: string[],
  possessiveReferences: string[],
): LlmParserScenePayload | null {
  if (!parsedScene || !parsedScene.relevant || parsedScene.beats.length === 0) {
    return parsedScene
  }

  const rankedHints = rankZoneScopedActionHints(
    content,
    zone,
    customZone,
    userReferences,
    possessiveReferences,
  )
  if (rankedHints.length === 0) {
    return parsedScene
  }

  const deterministicBeats = buildDeterministicZoneScopedBeats(
    content,
    '',
    zone,
    customZone,
    userReferences,
    possessiveReferences,
  )
  const hasBroadExcerpt = parsedScene.beats.some(
    (beat) => typeof beat.source_excerpt === 'string' && splitDebugLikeSentences(beat.source_excerpt).length > 2,
  )
  if ((parsedScene.beats.length <= 1 || hasBroadExcerpt) && deterministicBeats.length > 0) {
    return {
      ...parsedScene,
      beats: deterministicBeats,
    }
  }

  const topScore = rankedHints[0]?.score ?? 0
  const preferredActionHints = rankedHints
    .filter((entry) => entry.score >= Math.max(3, topScore - 1))
    .map((entry) => entry.actionType)

  const filteredBeats = parsedScene.beats.filter((beat) => preferredActionHints.includes(beat.action_type))
  if (filteredBeats.length > 0) {
    return {
      ...parsedScene,
      beats: filteredBeats,
    }
  }

  return {
    ...parsedScene,
    beats: parsedScene.beats.map((beat, index) =>
      index === 0
        ? {
            ...beat,
            action_type: preferredActionHints[0] ?? beat.action_type,
          }
        : beat,
    ),
  }
}

function splitDebugLikeSentences(content: string): string[] {
  return content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function includesUserPrimaryContactZone(
  content: string,
  zone: UserContactZone,
  customZone: string,
  possessiveReferences: string[],
  userReferences: string[],
): boolean {
  const normalized = content.toLowerCase()

  const userTerms = /\b(you|your|yours|yourself)\b/
  const zoneTerms = getUserZoneTerms(zone, customZone)
  const contactTerms =
    /\b(stroke|thrust|grind|lick|suck|ride|press|fuck|tease|rub|kiss|slide|suction|squeeze|pulse)\b/

  if (
    userTerms.test(normalized) &&
    zoneTerms.test(normalized) &&
    contactTerms.test(normalized) &&
    containsUserOwnedZoneReference(normalized, zone, customZone, possessiveReferences)
  ) {
    return true
  }

  if (
    /\b(thrust into your|stroke your|lick your|suck your|ride your|grind on your|fuck your|press to your|slide into your)\b/i.test(
      normalized,
    )
  ) {
    return true
  }

  if (
    containsPenetrationIntoOwnedZone(
      normalized,
      zone,
      customZone,
      possessiveReferences,
      userReferences,
    ) ||
    containsActorGenitalPenetration(normalized, zone, userReferences)
  ) {
    return true
  }

  return false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findContactLinkedCharacterProfiles(
  content: string,
  characterProfiles: ParticipantProfileBundle['characterProfiles'],
  userSide: 'actor' | 'actee',
): ParticipantProfileBundle['characterProfiles'] {
  if (characterProfiles.length <= 1) {
    return characterProfiles
  }

  const normalized = content.toLowerCase()
  const mentioned = characterProfiles.filter((profile) => {
    const fullNamePattern = new RegExp(`\\b${escapeRegExp(profile.displayName.toLowerCase())}\\b`, 'i')
    if (fullNamePattern.test(normalized)) return true

    const tokens = profile.displayName
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)

    return tokens.some((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(normalized))
  })

  if (mentioned.length > 0) {
    return mentioned
  }

  const pluralCue =
    userSide === 'actor'
      ? /\b(them|both|two|all|each|together|their)\b/i
      : /\b(they|them|both|two|all|each|their|together)\b/i

  if (pluralCue.test(normalized)) {
    return characterProfiles
  }

  return characterProfiles.slice(0, 1)
}

function buildParticipantStateAssignments(
  messageId: string,
  content: string,
  participantProfiles: ParticipantProfileBundle,
  chatPreferences: ChatTrackingPreferences,
  primaryUserContactZone: UserContactZone,
  customUserContactZone: string,
): ParticipantStateAssignment[] {
  const trackedReferences = buildTrackedReferenceHints(participantProfiles, chatPreferences)
  const possessiveReferences = buildTrackedPossessiveReferenceHints(participantProfiles, chatPreferences)
  if (
    !includesUserPrimaryContactZone(
      content,
      primaryUserContactZone,
      customUserContactZone,
      possessiveReferences,
      trackedReferences,
    )
  ) {
    return []
  }

  const actorTemplate = detectParticipantState(content, messageId, 'actor')
  const acteeTemplate = detectParticipantState(content, messageId, 'actee')
  const assignments: ParticipantStateAssignment[] = []

  const trackedProfile = resolveTrackedParticipantProfile(participantProfiles, chatPreferences)
  const trackedSide = inferTrackedParticipantLikelySide(content, trackedReferences)
  const includeUserCounterparty =
    trackedProfile?.participantKind === 'character' &&
    participantProfiles.userProfile != null &&
    /\b(you|your|yours|yourself)\b/i.test(content)
  const characterProfiles = findContactLinkedCharacterProfiles(
    content,
    participantProfiles.characterProfiles.filter(
      (profile) => profile.participantId !== trackedProfile?.participantId,
    ),
    trackedSide,
  )

  const actorParticipants: Array<{
    participantId: string | null
    participantKind: ParticipantStateAssignment['participantKind']
    displayName: string
    isUserPersona: boolean
  }> = []

  const acteeParticipants: Array<{
    participantId: string | null
    participantKind: ParticipantStateAssignment['participantKind']
    displayName: string
    isUserPersona: boolean
  }> = []

  if (trackedProfile) {
    const participant = {
      participantId: trackedProfile.participantId,
      participantKind: trackedProfile.participantKind,
      displayName: trackedProfile.displayName,
      isUserPersona: trackedProfile.participantKind === 'persona',
    }

    if (trackedSide === 'actor') {
      actorParticipants.push(participant)
    } else {
      acteeParticipants.push(participant)
    }
  }

  if (includeUserCounterparty && participantProfiles.userProfile) {
    const participant = {
      participantId: participantProfiles.userProfile.participantId,
      participantKind: participantProfiles.userProfile.participantKind,
      displayName: participantProfiles.userProfile.displayName,
      isUserPersona: true,
    }

    if (trackedSide === 'actor') {
      acteeParticipants.push(participant)
    } else {
      actorParticipants.push(participant)
    }
  }

  for (const profile of characterProfiles) {
    const participant = {
      participantId: profile.participantId,
      participantKind: profile.participantKind,
      displayName: profile.displayName,
      isUserPersona: false,
    }

    if (trackedProfile) {
      if (trackedSide === 'actor') {
        acteeParticipants.push(participant)
      } else {
        actorParticipants.push(participant)
      }
    } else {
      actorParticipants.push(participant)
    }
  }

  if (!trackedProfile && actorParticipants.length === 0 && acteeParticipants.length === 0) {
    actorParticipants.push({
      participantId: null,
      participantKind: null,
      displayName: 'Unknown actor',
      isUserPersona: false,
    })
    acteeParticipants.push({
      participantId: null,
      participantKind: null,
      displayName: 'Unknown actee',
      isUserPersona: false,
    })
  }

  const pushAssignments = (
    side: 'actor' | 'actee',
    participants: typeof actorParticipants,
    template: ParticipantState,
  ) => {
    if (participants.length === 0) return
    const weight = Number((1 / participants.length).toFixed(4))

    for (const participant of participants) {
      assignments.push({
        participantId: participant.participantId,
        participantKind: participant.participantKind,
        displayName: participant.displayName,
        side,
        weight,
        isUserPersona: participant.isUserPersona,
        state: { ...template },
      })
    }
  }

  pushAssignments('actor', actorParticipants, actorTemplate)
  pushAssignments('actee', acteeParticipants, acteeTemplate)
  return assignments
}

function resolveContinuityVerdict(
  previousPlan: MessagePlan | null,
  terminalBeat: Pick<SemanticBeat, 'actionType' | 'explicitStop'> | null,
): MessagePlan['continuityVerdict'] {
  if (terminalBeat?.explicitStop) return 'stop'
  if (!previousPlan || previousPlan.resolvedBeats.length === 0) return null
  if (!terminalBeat) return null

  const previousAction = previousPlan.resolvedBeats[previousPlan.resolvedBeats.length - 1]?.actionType
  if (!previousAction) return null

  return previousAction === terminalBeat.actionType ? 'modify' : 'replace'
}

function resolveTransitionMode(
  continuityVerdict: MessagePlan['continuityVerdict'],
): MessagePlan['transitionMode'] {
  if (continuityVerdict === 'modify') return 'modulate'
  if (continuityVerdict === 'replace') return 'replace'
  return null
}

function hasPersistentBeat(beat: Pick<SemanticBeat, 'persistence' | 'fallbackBehavior'> | null): boolean {
  if (!beat) return false
  return (
    /\b(ongoing|sustain|held?|continuous)\b/i.test(beat.persistence) ||
    beat.fallbackBehavior === 'hold_last'
  )
}

function resolveContinuityVerdictAgainstHeldState(
  heldState: HeldState,
  previousPlan: MessagePlan | null,
  entryBeat: Pick<SemanticBeat, 'actionType' | 'explicitStop'> | null,
): MessagePlan['continuityVerdict'] {
  if (entryBeat?.explicitStop) return 'stop'
  if (!entryBeat) return null

  if (heldState.actionFamily) {
    return heldState.actionFamily === entryBeat.actionType ? 'modify' : 'replace'
  }

  return resolveContinuityVerdict(previousPlan, entryBeat)
}

function resolveTransitionModeAgainstHeldState(
  heldState: HeldState,
  semanticBeats: SemanticBeat[],
  continuityVerdict: MessagePlan['continuityVerdict'],
): MessagePlan['transitionMode'] {
  if (!heldState.actionFamily || semanticBeats.length === 0) {
    return resolveTransitionMode(continuityVerdict)
  }

  if (continuityVerdict === 'stop') {
    return 'replace'
  }

  const entryAction = semanticBeats[0]?.actionType ?? null
  const actionFamilies = [...new Set(semanticBeats.map((beat) => beat.actionType))]
  const terminalAction = semanticBeats[semanticBeats.length - 1]?.actionType ?? null

  if (entryAction == null) {
    return resolveTransitionMode(continuityVerdict)
  }

  if (heldState.actionFamily === entryAction) {
    return 'modulate'
  }

  if (
    actionFamilies.length > 1 &&
    actionFamilies.includes(heldState.actionFamily) &&
    entryAction !== heldState.actionFamily &&
    terminalAction != null &&
    terminalAction === heldState.actionFamily
  ) {
    return 'blend'
  }

  return 'replace'
}

function resolveEndOfPlaybackResolution(
  plan: MessagePlan,
  previousHeldState: HeldState,
): EndOfPlaybackResolution {
  const terminalBeat = [...plan.semanticBeats].sort((left, right) => left.orderIndex - right.orderIndex).at(-1) ?? null

  if (plan.playbackMode === 'loop') {
    return 'loop_current_plan'
  }

  if (plan.continuityVerdict === 'stop' || terminalBeat?.explicitStop) {
    return 'idle'
  }

  if (
    terminalBeat &&
    previousHeldState.actionFamily &&
    terminalBeat.fallbackBehavior === 'resume_previous' &&
    !hasPersistentBeat(terminalBeat)
  ) {
    return 'resume_previous_held'
  }

  if (plan.playbackMode === 'hold' || hasPersistentBeat(terminalBeat)) {
    return 'hold_new_final'
  }

  return 'idle'
}

function buildHeldStateFromPlan(
  plan: MessagePlan,
  chatId: string | null,
  contactZone: UserContactZone,
  atIso: string,
  previousHeldState: HeldState,
): HeldState {
  const terminalSemanticBeat = [...plan.semanticBeats]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .at(-1) ?? null
  const terminalResolvedBeat = [...plan.resolvedBeats]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .at(-1) ?? null

  if (!terminalSemanticBeat || !terminalResolvedBeat) {
    return { ...DEFAULT_SESSION_STATE.heldState }
  }

  const resolvedPreset = plan.resolvedBeats.length > 0
    ? ({
        semanticActionType: terminalSemanticBeat.actionType,
        supported: true,
        fallbackTarget: null,
        baseAmplitude: terminalResolvedBeat.amplitude,
        baseTempo: terminalResolvedBeat.tempo,
        preferredExecutionProfile: terminalResolvedBeat.executionProfile,
        preferredTransitionStyle: terminalResolvedBeat.transitionStyle,
        repeatStyle: plan.playbackMode,
        holdTendency: hasPersistentBeat(terminalSemanticBeat) ? 100 : 0,
        revision: 0,
      } satisfies ActionCalibrationPreset)
    : null

  return {
    actionFamily: terminalSemanticBeat.actionType,
    resolvedActionPreset: resolvedPreset,
    resolvedExecutionProfile: terminalResolvedBeat.executionProfile,
    contactZone,
    strength: terminalResolvedBeat.amplitude,
    frequency: terminalResolvedBeat.tempo,
    persistence: terminalSemanticBeat.persistence,
    actorContribution: terminalSemanticBeat.actorWeight,
    acteeContribution: terminalSemanticBeat.acteeWeight,
    sourceMessageId: plan.messageId,
    chatId,
    startedAt:
      previousHeldState.actionFamily === terminalSemanticBeat.actionType && previousHeldState.startedAt
        ? previousHeldState.startedAt
        : atIso,
    lastUpdatedAt: atIso,
  }
}

function applyPhase9Controller(
  plan: MessagePlan,
  previousHeldState: HeldState,
  previousPlan: MessagePlan | null,
  chatId: string | null,
  contactZone: UserContactZone,
  atIso: string,
): {
  plan: MessagePlan
  heldState: HeldState
  currentHeldStateRef: string | null
  continuityMemoryPatch: Record<string, unknown>
} {
  const orderedSemanticBeats = [...plan.semanticBeats].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  )
  const entrySemanticBeat = orderedSemanticBeats[0] ?? null
  const terminalSemanticBeat = orderedSemanticBeats.at(-1) ?? null

  const continuityVerdict = resolveContinuityVerdictAgainstHeldState(
    previousHeldState,
    previousPlan,
    entrySemanticBeat,
  )
  const transitionMode = resolveTransitionModeAgainstHeldState(
    previousHeldState,
    orderedSemanticBeats,
    continuityVerdict,
  )
  const controlledPlan: MessagePlan = {
    ...plan,
    continuityVerdict,
    transitionMode,
    endResolution: null,
  }
  const endResolution = resolveEndOfPlaybackResolution(controlledPlan, previousHeldState)
  controlledPlan.endResolution = endResolution

  let nextHeldState: HeldState
  if (endResolution === 'hold_new_final' || endResolution === 'loop_current_plan') {
    nextHeldState = buildHeldStateFromPlan(
      controlledPlan,
      chatId,
      contactZone,
      atIso,
      previousHeldState,
    )
  } else if (endResolution === 'resume_previous_held' && previousHeldState.actionFamily) {
    nextHeldState = {
      ...previousHeldState,
      lastUpdatedAt: atIso,
    }
  } else {
    nextHeldState = {
      ...DEFAULT_SESSION_STATE.heldState,
    }
  }

  return {
    plan: controlledPlan,
    heldState: nextHeldState,
    currentHeldStateRef: nextHeldState.sourceMessageId,
    continuityMemoryPatch: {
      lastTransitionMode: transitionMode,
      lastEndResolution: endResolution,
      lastHeldActionFamily: nextHeldState.actionFamily,
    },
  }
}

type LightweightRelevanceVerdict = 'relevant' | 'non_relevant' | 'explicit_stop'

function detectExplicitStop(content: string): boolean {
  return /\b(stops|withdraws|pulls away|breaks contact|lets go|pulls out|backs off)\b/i.test(content)
}

function detectRelevantUserZoneContact(
  content: string,
  zone: UserContactZone,
  customZone: string,
  possessiveReferences: string[],
  userReferences: string[],
): boolean {
  const normalized = content.toLowerCase()

  const zoneTerms = getUserZoneTerms(zone, customZone)
  const contactTerms =
    /(stroke|thrust|grind|suck|suction|lick|squeeze|pulse|tease|rub|ride|fuck|press|deepen|quicken|touch|kiss|slide)/

  return (
    (zoneTerms.test(normalized) &&
      contactTerms.test(normalized) &&
      containsUserOwnedZoneReference(normalized, zone, customZone, possessiveReferences)) ||
    containsPenetrationIntoOwnedZone(
      normalized,
      zone,
      customZone,
      possessiveReferences,
      userReferences,
    ) ||
    containsActorGenitalPenetration(normalized, zone, userReferences)
  )
}

function evaluateLaterMessage(
  content: string,
  zone: UserContactZone,
  customZone: string,
  possessiveReferences: string[],
  userReferences: string[],
): LightweightRelevanceVerdict {
  if (detectExplicitStop(content)) return 'explicit_stop'
  if (detectRelevantUserZoneContact(content, zone, customZone, possessiveReferences, userReferences))
    return 'relevant'
  return 'non_relevant'
}

function clearHeldAndContinuity(session: SessionState): SessionState {
  return {
    ...session,
    heldState: {
      ...DEFAULT_SESSION_STATE.heldState,
    },
    parserSession: {
      ...session.parserSession,
      currentHeldStateRef: null,
      continuityMemory: {},
    },
  }
}

async function buildMessagePlan(
  chatId: string,
  messageId: string,
  userId: string,
  characterId: string | null,
  settings: UserSettings,
  session: SessionState,
  playbackModeOverride: PlaybackMode | null,
): Promise<MessagePlan> {
  const participantProfiles = await getParticipantProfilesSafely(userId, chatId, characterId)
  const chatPreferences = await readChatTrackingPreferences(spindle, userId, chatId, settings)
  const messages = await spindle.chat.getMessages(chatId)
  const selectedIndex = messages.findIndex((message) => message.id === messageId)
  const selected = selectedIndex >= 0 ? messages[selectedIndex] : undefined

  if (!selected) {
    throw new Error(`Message ${messageId} was not found in chat ${chatId}`)
  }

  if (selected.role !== 'assistant') {
    throw new Error('Only assistant messages can be played')
  }

  const recentContext = messages
    .slice(Math.max(0, selectedIndex - 3), selectedIndex)
    .filter((message) => message.role === 'assistant' || message.role === 'user')
    .map((message) => ({
      role: message.role as 'assistant' | 'user',
      content: message.content,
    }))
  const trackedReferenceHints = buildTrackedReferenceHints(participantProfiles, chatPreferences)
  const trackedPossessiveReferenceHints = buildTrackedPossessiveReferenceHints(
    participantProfiles,
    chatPreferences,
  )
  const hasUserOwnedZoneContact = includesUserPrimaryContactZone(
    selected.content,
    chatPreferences.primaryContactZone,
    chatPreferences.customContactZone,
    trackedPossessiveReferenceHints,
    trackedReferenceHints,
  )
  const deterministicZoneBeats = buildDeterministicZoneScopedBeats(
    selected.content,
    messageId,
    chatPreferences.primaryContactZone,
    chatPreferences.customContactZone,
    trackedReferenceHints,
    trackedPossessiveReferenceHints,
  )
  const rankedTrackedHints = rankZoneScopedActionHints(
    selected.content,
    chatPreferences.primaryContactZone,
    chatPreferences.customContactZone,
    trackedReferenceHints,
    trackedPossessiveReferenceHints,
  )
  const actionType = rankedTrackedHints[0]?.actionType ?? detectActionType(selected.content)
  const preset =
    settings.actionCalibrationPresets.find((entry) => entry.semanticActionType === actionType) ??
    settings.actionCalibrationPresets[0]

  if (!preset) {
    throw new Error('No tactile calibration presets are available')
  }

  const mapping =
    settings.xtoysActionMappings.find((entry) => entry.semanticActionType === actionType) ?? null

  let parsedScene: LlmParserScenePayload | null = null
  try {
    parsedScene = repairParsedSceneToZoneScopedActions(
      await runStructuredSceneParser(
        userId,
        settings,
        chatPreferences,
        selected.content,
        recentContext,
        participantProfiles,
      ),
      selected.content,
      chatPreferences.primaryContactZone,
      chatPreferences.customContactZone,
      trackedReferenceHints,
      trackedPossessiveReferenceHints,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    spindle.log.warn(`Lummate structured scene parser fallback: ${message}`)
  }

  if (parsedScene && !parsedScene.relevant) {
    return {
      messageId,
      createdAt: new Date().toISOString(),
      playbackMode: playbackModeOverride ?? preset.repeatStyle,
      parserSource: 'llm',
      participantStates: [],
      semanticBeats: [],
      resolvedBeats: [],
      continuityVerdict: parsedScene.continuity_verdict,
      transitionMode: resolveTransitionMode(parsedScene.continuity_verdict),
      endResolution: 'idle',
    }
  }

  if (!parsedScene?.relevant && !hasUserOwnedZoneContact && deterministicZoneBeats.length === 0) {
    return {
      messageId,
      createdAt: new Date().toISOString(),
      playbackMode: playbackModeOverride ?? preset.repeatStyle,
      parserSource: 'heuristic_fallback',
      participantStates: [],
      semanticBeats: [],
      resolvedBeats: [],
      continuityVerdict: null,
      transitionMode: null,
      endResolution: 'idle',
    }
  }

  const sortedLlmBeats = parsedScene?.relevant ? sortBeatPayloads(parsedScene.beats) : []
  const llmBeat = sortedLlmBeats[0] ?? null
  const resolvedActionType = llmBeat ? normalizeActionType(llmBeat.action_type) : actionType
  const resolvedPreset = resolvePresetForActionType(resolvedActionType, settings) ?? preset
  const resolvedMapping =
    resolveMappingForActionType(resolvedActionType, settings, resolvedPreset) ?? mapping

  const parserSource: MessagePlan['parserSource'] =
    parsedScene?.relevant && parsedScene.beats.length > 0
      ? 'llm'
      : deterministicZoneBeats.length > 0
        ? 'deterministic_zone_fallback'
        : 'heuristic_fallback'

  const allowGenericHeuristicFallback =
    chatPreferences.primaryContactZone === 'genitals' || deterministicZoneBeats.length > 0

  const semanticBeats: SemanticBeat[] =
    parsedScene?.relevant && sortedLlmBeats.length > 0
      ? sortedLlmBeats.map((beat, index) => {
          const durationClass = normalizeDurationClass(beat.duration_class)
          const normalizedWeights = normalizeBeatWeights(beat.actor_weight, beat.actee_weight)
          const durationMs =
            typeof beat.duration_ms === 'number'
              ? Math.max(250, Math.round(beat.duration_ms))
              : resolveDurationMsFromClass(durationClass)

          return {
            messageId,
            orderIndex: typeof beat.order_index === 'number' ? beat.order_index : index,
            sourceExcerpt:
              typeof beat.source_excerpt === 'string' && beat.source_excerpt.trim().length > 0
                ? beat.source_excerpt.trim()
                : '',
            actionType: normalizeActionType(beat.action_type),
            strength: clamp(beat.strength, 0, 100),
            frequency: clamp(beat.frequency, 0, 100),
            durationClass,
            durationMs,
            transitionStyle: normalizeTransitionStyle(beat.transition_style),
            countHint: normalizeCountHint(beat.count_hint),
            persistence: beat.persistence,
            responseMode: normalizeResponseMode(beat.response_mode),
            actorWeight: normalizedWeights.actorWeight,
            acteeWeight: normalizedWeights.acteeWeight,
            explicitChange: Boolean(beat.explicit_change),
            explicitStop: Boolean(beat.explicit_stop),
            fallbackBehavior: normalizeFallbackBehavior(beat.fallback_behavior),
          }
        })
      : deterministicZoneBeats.length > 0
        ? deterministicZoneBeats.map((beat, index) => {
            const durationClass = normalizeDurationClass(beat.duration_class)
            const normalizedWeights = normalizeBeatWeights(beat.actor_weight, beat.actee_weight)
            const durationMs =
              typeof beat.duration_ms === 'number'
                ? Math.max(250, Math.round(beat.duration_ms))
                : resolveDurationMsFromClass(durationClass)

            return {
              messageId,
              orderIndex: typeof beat.order_index === 'number' ? beat.order_index : index,
              sourceExcerpt:
                typeof beat.source_excerpt === 'string' && beat.source_excerpt.trim().length > 0
                  ? beat.source_excerpt.trim()
                  : '',
              actionType: normalizeActionType(beat.action_type),
              strength: clamp(beat.strength, 0, 100),
              frequency: clamp(beat.frequency, 0, 100),
              durationClass,
              durationMs,
              transitionStyle: normalizeTransitionStyle(beat.transition_style),
              countHint: normalizeCountHint(beat.count_hint),
              persistence: beat.persistence,
              responseMode: normalizeResponseMode(beat.response_mode),
              actorWeight: normalizedWeights.actorWeight,
              acteeWeight: normalizedWeights.acteeWeight,
              explicitChange: Boolean(beat.explicit_change),
              explicitStop: Boolean(beat.explicit_stop),
              fallbackBehavior: normalizeFallbackBehavior(beat.fallback_behavior),
            }
          })
      : allowGenericHeuristicFallback
        ? [
          {
            messageId,
            orderIndex: 0,
            sourceExcerpt: selected.content,
            actionType: resolvedActionType,
            strength: detectStrength(selected.content, resolvedPreset),
            frequency: detectTempo(selected.content, resolvedPreset),
            durationClass: detectDurationClass(selected.content, resolvedActionType),
            durationMs: detectDurationMs(selected.content, resolvedActionType),
            transitionStyle: 'unknown',
            countHint: 'unknown',
            persistence: detectPersistence(selected.content, resolvedPreset, playbackModeOverride),
            responseMode: 'lead',
            actorWeight: 0.5,
            acteeWeight: 0.5,
            explicitChange: /\b(becomes|turns|shifts|changes|deepens|quickens)\b/i.test(selected.content),
            explicitStop: /\b(stops|withdraws|pulls away|breaks contact|lets go)\b/i.test(selected.content),
            fallbackBehavior: 'unknown',
          },
        ]
        : []

  const participantStates =
    parsedScene != null
      ? mapLlmParticipantsToAssignments(
          parsedScene,
          messageId,
          selected.content,
          participantProfiles,
          chatPreferences,
          chatPreferences.primaryContactZone,
          chatPreferences.customContactZone,
        )
      : buildParticipantStateAssignments(
          messageId,
          selected.content,
          participantProfiles,
          chatPreferences,
          chatPreferences.primaryContactZone,
          chatPreferences.customContactZone,
        )

  const resolvedBeats: ResolvedBeat[] = semanticBeats.map((semanticBeat) => {
    const beatPreset =
      resolvePresetForActionType(semanticBeat.actionType, settings) ??
      resolvedPreset
    const beatMapping =
      resolveMappingForActionType(semanticBeat.actionType, settings, beatPreset) ??
      resolvedMapping
    const responseFactors = resolveCombinedResponseFactors(semanticBeat)
    const participantFactors = resolveParticipantContributionFactors(
      semanticBeat,
      participantStates,
      participantProfiles,
    )
    const amplitudeFactor = clamp(
      responseFactors.amplitudeFactor * participantFactors.amplitudeFactor,
      0.5,
      1.75,
    )
    const tempoFactor = clamp(
      responseFactors.tempoFactor * participantFactors.tempoFactor,
      0.5,
      1.75,
    )
    const calibratedAmplitudeBase = resolveCalibratedAxisBase(
      semanticBeat.strength,
      beatPreset.baseAmplitude,
    )
    const calibratedTempoBase = resolveCalibratedAxisBase(
      semanticBeat.frequency,
      beatPreset.baseTempo,
    )

    return {
      messageId,
      orderIndex: semanticBeat.orderIndex,
      sourceExcerpt: semanticBeat.sourceExcerpt,
      actionType: semanticBeat.actionType,
      xtoysActionName:
        beatMapping?.xtoysActionName || beatMapping?.fallbackActionName || semanticBeat.actionType,
      executionProfile: beatPreset.preferredExecutionProfile,
      amplitude: clamp(Math.round(calibratedAmplitudeBase * amplitudeFactor), 0, 100),
      tempo: clamp(Math.round(calibratedTempoBase * tempoFactor), 0, 100),
      durationMs: clamp(
        Math.round(semanticBeat.durationMs * participantFactors.durationFactor),
        250,
        30000,
      ),
      transitionStyle: semanticBeat.transitionStyle,
      countHint: semanticBeat.countHint,
      persistence: semanticBeat.persistence,
      fallbackBehavior: semanticBeat.fallbackBehavior,
    }
  })

  const terminalSemanticBeat = [...semanticBeats]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .at(-1) ?? null
  const continuityVerdict =
    parsedScene?.relevant && parsedScene.continuity_verdict != null
      ? parsedScene.continuity_verdict
      : resolveContinuityVerdict(session.runtimePlans.currentPlan, terminalSemanticBeat)
  const transitionMode = resolveTransitionMode(continuityVerdict)
    return {
      messageId,
      createdAt: new Date().toISOString(),
      playbackMode: playbackModeOverride ?? preset.repeatStyle,
      parserSource,
      participantStates,
      semanticBeats,
      resolvedBeats,
      continuityVerdict,
      transitionMode,
      endResolution: null,
    }
}

async function handleFrontendMessage(
  payload: FrontendToBackendMessage,
  userId: string,
): Promise<void> {
  try {
    switch (payload.type) {
      case 'lummate.phase1.bootstrap': {
        const bootstrap = await buildBootstrap(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
        )
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
        const bootstrap = await buildBootstrap(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
        )
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
        const current = syncSessionToChat(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
        )
        const nextActiveMessageId =
          current.activeMessageId === payload.payload.messageId
            ? null
            : payload.payload.messageId

        const settings = await readUserSettings(spindle, userId)
        const nextRuntimePlans = { ...current.runtimePlans }
        let nextHeldState = { ...current.heldState }
        let currentHeldStateRef = current.parserSession.currentHeldStateRef
        let continuityMemoryPatch: Record<string, unknown> = {}

        if (payload.payload.chatId && nextActiveMessageId) {
          const nextPlan = await buildMessagePlan(
            payload.payload.chatId,
            payload.payload.messageId,
            userId,
            payload.payload.characterId,
            settings,
            current,
            payload.payload.playbackModeOverride ?? null,
          )
          const chatPreferences = await readChatTrackingPreferences(
            spindle,
            userId,
            payload.payload.chatId,
            settings,
          )
          const controllerResult = applyPhase9Controller(
            nextPlan,
            current.heldState,
            current.runtimePlans.currentPlan,
            payload.payload.chatId,
            chatPreferences.primaryContactZone,
            new Date().toISOString(),
          )

          nextRuntimePlans.previousPlan = current.runtimePlans.currentPlan
          nextRuntimePlans.currentPlan = controllerResult.plan
          nextHeldState = controllerResult.heldState
          currentHeldStateRef = controllerResult.currentHeldStateRef
          continuityMemoryPatch = controllerResult.continuityMemoryPatch
        }

        const nextSession: SessionState = {
          ...current,
          activeChatId: payload.payload.chatId,
          activeCharacterId: payload.payload.characterId,
          activeMessageId: nextActiveMessageId,
          lastPlayedMessageId: payload.payload.messageId,
          lastUpdatedAt: new Date().toISOString(),
          parserSession: {
            ...current.parserSession,
            armed: current.parserSession.armed || nextActiveMessageId !== null,
            consecutiveNonRelevantMessageCount:
              nextActiveMessageId !== null ? 0 : current.parserSession.consecutiveNonRelevantMessageCount,
            lastRelevantMessageId:
              nextActiveMessageId !== null
                ? payload.payload.messageId
                : current.parserSession.lastRelevantMessageId,
            continuityMemory:
              nextActiveMessageId !== null
                ? {
                    ...current.parserSession.continuityMemory,
                    lastPlayedMessageId: payload.payload.messageId,
                    lastPlayArmedAt: new Date().toISOString(),
                    ...continuityMemoryPatch,
                  }
                : current.parserSession.continuityMemory,
            currentHeldStateRef,
          },
          heldState: nextActiveMessageId !== null ? nextHeldState : current.heldState,
          runtimePlans: nextRuntimePlans,
        }

        runtimeSessions.set(userId, nextSession)
        activeChatIds.set(userId, payload.payload.chatId)

        const bootstrap = await buildBootstrap(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
        )
        sendToUser(
          {
            type: 'lummate.phase1.session_state',
            payload: bootstrap,
          },
          userId,
        )
        return
      }
      case 'lummate.phase3.regenerate': {
        if (!payload.payload.chatId) {
          throw new Error('Cannot regenerate a plan without an active chat')
        }

        const current = syncSessionToChat(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
        )
        const settings = await readUserSettings(spindle, userId)
        const regeneratedPlan = await buildMessagePlan(
          payload.payload.chatId,
          payload.payload.messageId,
          userId,
          payload.payload.characterId,
          settings,
          current,
          payload.payload.playbackModeOverride ?? null,
        )
        const chatPreferences = await readChatTrackingPreferences(
          spindle,
          userId,
          payload.payload.chatId,
          settings,
        )
        const controllerResult = applyPhase9Controller(
          regeneratedPlan,
          current.heldState,
          current.runtimePlans.previousPlan,
          payload.payload.chatId,
          chatPreferences.primaryContactZone,
          new Date().toISOString(),
        )

        const nextSession: SessionState = {
          ...current,
          activeChatId: payload.payload.chatId,
          activeCharacterId: payload.payload.characterId,
          lastUpdatedAt: new Date().toISOString(),
          heldState: controllerResult.heldState,
          parserSession: {
            ...current.parserSession,
            currentHeldStateRef: controllerResult.currentHeldStateRef,
            continuityMemory: {
              ...current.parserSession.continuityMemory,
              ...controllerResult.continuityMemoryPatch,
            },
          },
          runtimePlans: {
            ...current.runtimePlans,
            currentPlan: controllerResult.plan,
          },
        }

        runtimeSessions.set(userId, nextSession)
        activeChatIds.set(userId, payload.payload.chatId)

        const bootstrap = await buildBootstrap(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
        )
        sendToUser(
          {
            type: 'lummate.phase1.session_state',
            payload: bootstrap,
          },
          userId,
        )
        return
      }
      case 'lummate.phase3.set_playback_mode': {
        const current = syncSessionToChat(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
        )
        const currentPlan = current.runtimePlans.currentPlan

        let nextHeldState = current.heldState
        let currentHeldStateRef = current.parserSession.currentHeldStateRef
        let continuityMemoryPatch: Record<string, unknown> = {}
        let nextPlan = currentPlan

        if (currentPlan && payload.payload.chatId) {
          const chatPreferences = await readChatTrackingPreferences(
            spindle,
            userId,
            payload.payload.chatId,
            await readUserSettings(spindle, userId),
          )
          const controllerResult = applyPhase9Controller(
            {
              ...currentPlan,
              playbackMode: payload.payload.playbackMode,
            },
            current.heldState,
            current.runtimePlans.previousPlan,
            payload.payload.chatId,
            chatPreferences.primaryContactZone,
            new Date().toISOString(),
          )
          nextPlan = controllerResult.plan
          nextHeldState = controllerResult.heldState
          currentHeldStateRef = controllerResult.currentHeldStateRef
          continuityMemoryPatch = controllerResult.continuityMemoryPatch
        }

        const nextSession: SessionState = {
          ...current,
          activeCharacterId: payload.payload.characterId,
          lastUpdatedAt: new Date().toISOString(),
          heldState: nextHeldState,
          parserSession: {
            ...current.parserSession,
            currentHeldStateRef,
            continuityMemory: {
              ...current.parserSession.continuityMemory,
              ...continuityMemoryPatch,
            },
          },
          runtimePlans: {
            ...current.runtimePlans,
            currentPlan:
              currentPlan && currentPlan.messageId === payload.payload.messageId
                ? nextPlan
                : currentPlan,
          },
        }

        runtimeSessions.set(userId, nextSession)
        activeChatIds.set(userId, payload.payload.chatId)

        const bootstrap = await buildBootstrap(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
        )
        sendToUser(
          {
            type: 'lummate.phase1.session_state',
            payload: bootstrap,
          },
          userId,
        )
        return
      }
      case 'lummate.phase3.set_tracking_preferences': {
        if (!payload.payload.chatId) {
          throw new Error('Cannot update tracked participant without an active chat')
        }

        const settings = await readUserSettings(spindle, userId)
        await writeChatTrackingPreferences(spindle, userId, payload.payload.chatId, {
          trackedParticipantId: payload.payload.trackedParticipantId,
          trackedParticipantKind: payload.payload.trackedParticipantKind,
          primaryContactZone: settings.parser.primaryUserContactZone,
          customContactZone: settings.parser.customUserContactZone,
        }, settings)

        const bootstrap = await buildBootstrap(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
        )
        sendToUser(
          {
            type: 'lummate.phase1.session_state',
            payload: bootstrap,
          },
          userId,
        )
        return
      }
      case 'lummate.phase5.regenerate_profile': {
        const participantProfiles = await getParticipantProfilesSafely(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
          {
            forceUserRegenerate: payload.payload.participantKind === 'persona',
            forceCharacterRegenerate: payload.payload.participantKind === 'character',
          },
        )

        sendToUser(
          {
            type: 'lummate.phase5.profile_result',
            payload: participantProfiles,
          },
          userId,
        )
        return
      }
      case 'lummate.settings.bootstrap': {
        const settingsBootstrap = await buildSettingsBootstrap(
          userId,
          payload.payload.chatId,
          payload.payload.characterId,
        )
        sendToUser(
          {
            type: 'lummate.settings.bootstrap_result',
            payload: settingsBootstrap,
          },
          userId,
        )
        return
      }
      case 'lummate.settings.save': {
        const current = await readUserSettings(spindle, userId)
        const nextSettings = buildUpdatedSettings(current, payload.payload.settings)

        await writeUserSettings(spindle, userId, nextSettings)
        if (payload.payload.context.chatId) {
          const currentChatPreferences = await readChatTrackingPreferences(
            spindle,
            userId,
            payload.payload.context.chatId,
            nextSettings,
          )
          await writeChatTrackingPreferences(
            spindle,
            userId,
            payload.payload.context.chatId,
            {
              ...currentChatPreferences,
              primaryContactZone: nextSettings.parser.primaryUserContactZone,
              customContactZone: nextSettings.parser.customUserContactZone,
            },
            nextSettings,
          )
        }

        const settingsBootstrap = await buildSettingsBootstrap(
          userId,
          payload.payload.context.chatId,
          payload.payload.context.characterId,
        )
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

spindle.on('GENERATION_ENDED', async (payload, userId) => {
  if (!userId) return
  if (!payload.chatId) return
  if (!payload.content || payload.error) return
  if ((activeChatIds.get(userId) ?? null) !== payload.chatId) return

  const current = syncSessionToChat(userId, payload.chatId, getRuntimeSession(userId).activeCharacterId)
  if (!current.parserSession.armed) return

  const settings = await readUserSettings(spindle, userId)
  const participantProfiles = await getParticipantProfilesSafely(
    userId,
    payload.chatId,
    current.activeCharacterId,
  )
  const chatPreferences = await readChatTrackingPreferences(spindle, userId, payload.chatId, settings)
  const possessiveReferences = buildTrackedPossessiveReferenceHints(participantProfiles, chatPreferences)
  const verdict = evaluateLaterMessage(
    payload.content,
    chatPreferences.primaryContactZone,
    chatPreferences.customContactZone,
    possessiveReferences,
    buildTrackedReferenceHints(participantProfiles, chatPreferences),
  )
  let nextSession: SessionState = {
    ...current,
    lastUpdatedAt: new Date().toISOString(),
  }

  if (verdict === 'relevant') {
    nextSession = {
      ...nextSession,
      parserSession: {
        ...nextSession.parserSession,
        consecutiveNonRelevantMessageCount: 0,
        lastRelevantMessageId: payload.messageId ?? nextSession.parserSession.lastRelevantMessageId,
        continuityMemory: {
          ...nextSession.parserSession.continuityMemory,
          lastEvaluatedMessageId: payload.messageId ?? null,
          lastEvaluationVerdict: verdict,
          lastEvaluationAt: new Date().toISOString(),
        },
      },
    }
  } else if (verdict === 'explicit_stop') {
    nextSession = clearHeldAndContinuity(nextSession)
    nextSession = {
      ...nextSession,
      parserSession: {
        ...nextSession.parserSession,
        armed: true,
        consecutiveNonRelevantMessageCount: 0,
        continuityMemory: {
          ...nextSession.parserSession.continuityMemory,
          lastEvaluatedMessageId: payload.messageId ?? null,
          lastEvaluationVerdict: verdict,
          lastEvaluationAt: new Date().toISOString(),
        },
      },
    }
  } else {
    const nextCount = nextSession.parserSession.consecutiveNonRelevantMessageCount + 1
    nextSession = {
      ...nextSession,
      parserSession: {
        ...nextSession.parserSession,
        consecutiveNonRelevantMessageCount: nextCount,
        continuityMemory: {
          ...nextSession.parserSession.continuityMemory,
          lastEvaluatedMessageId: payload.messageId ?? null,
          lastEvaluationVerdict: verdict,
          lastEvaluationAt: new Date().toISOString(),
        },
      },
    }
    const threshold = settings.parser.deactivationThreshold
    if (nextCount >= threshold) {
      nextSession = clearHeldAndContinuity(nextSession)
      nextSession = {
        ...nextSession,
        parserSession: {
          ...nextSession.parserSession,
          armed: false,
          consecutiveNonRelevantMessageCount: 0,
          lastRelevantMessageId: null,
          continuityMemory: {},
        },
      }
    }
  }

  runtimeSessions.set(userId, nextSession)
  activeChatIds.set(userId, payload.chatId)

  const bootstrap = await buildBootstrap(userId, payload.chatId, current.activeCharacterId)
  sendToUser(
    {
      type: 'lummate.phase1.session_state',
      payload: bootstrap,
    },
    userId,
  )
})

spindle.log.info('Lummate phase 1 backend loaded')

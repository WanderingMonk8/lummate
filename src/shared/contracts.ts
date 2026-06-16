export type PlaybackMode = 'once' | 'loop' | 'hold'

export type ParticipantKind = 'character' | 'persona'
export type ParticipantSide = 'actor' | 'actee'
export type UserContactZone = 'genitals' | 'anus' | 'mouth' | 'custom'
export type ResponseMode = 'lead' | 'meet' | 'withdraw' | 'mutual'
export type ContinuityVerdict = 'continue' | 'progress' | 'modify' | 'replace' | 'stop'
export type TransitionMode = 'replace' | 'modulate' | 'blend'
export type EndOfPlaybackResolution =
  | 'idle'
  | 'hold_new_final'
  | 'resume_previous_held'
  | 'loop_current_plan'
export type SchedulerStatus = 'idle' | 'playing' | 'holding' | 'looping' | 'stopped'
export type DurationClass =
  | 'instant'
  | 'very_short'
  | 'short'
  | 'medium'
  | 'long'
  | 'extended'
  | 'ongoing'

export type TransitionStyle = 'ramp' | 'snap' | 'pulse' | 'fade' | 'steady' | 'unknown'
export type CountHint = 'one_shot' | 'few' | 'repeated' | 'continuous' | 'unknown'
export type BeatFallbackBehavior =
  | 'resume_previous'
  | 'idle'
  | 'hold_last'
  | 'clear'
  | 'unknown'

export type ActionType =
  | 'tease'
  | 'finger'
  | 'stroke'
  | 'thrust'
  | 'suction'
  | 'grind'
  | 'pulse'
  | 'lick'
  | 'squeeze'
  | 'pause'

export type ExecutionProfile =
  | 'intensity_direct'
  | 'pattern_scripted'
  | 'pattern_funscript'
  | 'composite_blend'
  | 'parallel_blend'
  | 'unknown'

export type ParserConnectionFallback = 'default_connection' | 'fail_closed'

export interface MechanicalAxes {
  baselineStrengthBias: number
  baselineTempoBias: number
  rampAggression: number
  motionWeight: number
  endurance: number
  smoothness: number
  dominancePressure: number
  teasingTendency: number
}

export interface ParticipantProfile {
  participantKind: ParticipantKind
  participantId: string
  displayName: string
  aliasHints: string[]
  sourceCardId: string | null
  sourceCardName: string | null
  sourceFingerprint: string | null
  sourceUpdatedAt: number | null
  sourcePreview: string
  mechanicalAxes: MechanicalAxes
  userOverrides: Partial<MechanicalAxes>
  updatedAt: string | null
}

export interface ParticipantProfileBundle {
  userProfile: ParticipantProfile | null
  characterProfiles: ParticipantProfile[]
}

export interface ParticipantState {
  arousal: number
  energy: number
  steadiness: number
  focus: number
  provenance: 'parsed' | 'baseline'
  sourceMessageId: string | null
}

export interface ParticipantStateAssignment {
  participantId: string | null
  participantKind: ParticipantKind | null
  displayName: string
  side: ParticipantSide
  weight: number
  isUserPersona: boolean
  state: ParticipantState
}

export interface ParserConnectionSettings {
  parserConnectionId: string | null
  primaryUserContactZone: UserContactZone
  customUserContactZone: string
  deactivationThreshold: number
  fallbackBehavior: ParserConnectionFallback
}

export interface ChatTrackingPreferences {
  trackedParticipantId: string | null
  trackedParticipantKind: ParticipantKind
  primaryContactZone: UserContactZone
  customContactZone: string
}

export interface ConnectionProfileSummary {
  id: string
  name: string
  provider: string
  model: string
  isDefault: boolean
  hasApiKey: boolean
}

export interface XToysActionMappingSettings {
  semanticActionType: ActionType
  xtoysActionName: string
  fallbackActionName: string | null
  supported: boolean
  updatedAt: string | null
}

export interface ActionCalibrationPreset {
  semanticActionType: ActionType
  supported: boolean
  fallbackTarget: ActionType | null
  baseAmplitude: number
  baseTempo: number
  preferredExecutionProfile: ExecutionProfile
  preferredTransitionStyle: string
  repeatStyle: PlaybackMode
  holdTendency: number
  revision: number
}

export interface SemanticBeat {
  messageId: string
  orderIndex: number
  sourceExcerpt: string
  actionType: ActionType
  strength: number
  frequency: number
  durationClass: DurationClass
  durationMs: number
  transitionStyle: TransitionStyle
  countHint: CountHint
  persistence: string
  responseMode: ResponseMode
  actorWeight: number
  acteeWeight: number
  explicitChange: boolean
  explicitStop: boolean
  fallbackBehavior: BeatFallbackBehavior
}

export interface ResolvedBeat {
  messageId: string
  orderIndex: number
  sourceExcerpt: string
  actionType: ActionType
  xtoysActionName: string
  executionProfile: ExecutionProfile
  amplitude: number
  tempo: number
  rampFactor: number
  durationMs: number
  transitionStyle: TransitionStyle
  countHint: CountHint
  persistence: string
  fallbackBehavior: BeatFallbackBehavior
}

export interface MessagePlan {
  messageId: string
  createdAt: string
  playbackMode: PlaybackMode
  parserSource: 'llm' | 'deterministic_zone_fallback' | 'heuristic_fallback'
  participantStates: ParticipantStateAssignment[]
  semanticBeats: SemanticBeat[]
  resolvedBeats: ResolvedBeat[]
  continuityVerdict: ContinuityVerdict | null
  transitionMode: TransitionMode | null
  endResolution: EndOfPlaybackResolution | null
}

export interface RuntimePlanBuffer {
  currentPlan: MessagePlan | null
  previousPlan: MessagePlan | null
}

export interface HeldState {
  actionFamily: ActionType | null
  resolvedActionPreset: ActionCalibrationPreset | null
  resolvedExecutionProfile: ExecutionProfile
  contactZone: UserContactZone | null
  strength: number
  frequency: number
  persistence: string | null
  actorContribution: number
  acteeContribution: number
  sourceMessageId: string | null
  chatId: string | null
  startedAt: string | null
  lastUpdatedAt: string | null
}

export interface ParserSessionState {
  armed: boolean
  consecutiveNonRelevantMessageCount: number
  lastRelevantMessageId: string | null
  currentHeldStateRef: string | null
  continuityMemory: Record<string, unknown>
}

export interface SchedulerState {
  status: SchedulerStatus
  activePlanMessageId: string | null
  activeBeatIndex: number | null
  activeBeatStartedAt: string | null
  playbackCycle: number
  lastCompletionReason: 'completed' | 'stopped' | 'replaced' | 'panic_stop' | null
  lastDispatchKind: 'beat' | 'control' | null
  lastDispatchAction: string | null
  lastDispatchAt: string | null
  lastDispatchStatus: 'ok' | 'error' | null
  lastDispatchError: string | null
}

export interface XToysDeliverySettings {
  enabled: boolean
  mode: 'action_trigger_compat'
  privateWebhookId: string
  webhookBaseUrl: string
  requestTimeoutMs: number
  maxIntensity: number
  maxRampSeconds: number
  stopActionName: string
  holdActionName: string
  resumeActionName: string
  panicStopActionName: string
  triggerFieldName: string
  intensityFieldName: string
  rampSecondsFieldName: string
}

export interface UserSettings {
  parser: ParserConnectionSettings
  xtoysDelivery: XToysDeliverySettings
  xtoysActionMappings: XToysActionMappingSettings[]
  actionCalibrationPresets: ActionCalibrationPreset[]
}

export interface SessionState {
  activeChatId: string | null
  activeCharacterId: string | null
  activeMessageId: string | null
  lastPlayedMessageId: string | null
  lastUpdatedAt: string | null
  parserSession: ParserSessionState
  scheduler: SchedulerState
  heldState: HeldState
  runtimePlans: RuntimePlanBuffer
}

export interface BootstrapPayload {
  settings: UserSettings
  session: SessionState
  chatPreferences: ChatTrackingPreferences
  participantProfiles: ParticipantProfileBundle
}

export interface SettingsBootstrapPayload {
  settings: UserSettings
  availableConnections: ConnectionProfileSummary[]
  participantProfiles: ParticipantProfileBundle
  chatPreferences: ChatTrackingPreferences
}

export interface SettingsSavePayload {
  settings: UserSettings
}

export interface PlayTogglePayload {
  chatId: string | null
  characterId: string | null
  messageId: string
  playbackModeOverride?: PlaybackMode | null
}

export interface ChatScopedPayload {
  chatId: string | null
  characterId: string | null
}

export interface RegeneratePayload {
  chatId: string | null
  characterId: string | null
  messageId: string
  playbackModeOverride?: PlaybackMode | null
}

export interface SetPlaybackModePayload {
  chatId: string | null
  characterId: string | null
  messageId: string
  playbackMode: PlaybackMode
}

export interface SetTrackingPreferencesPayload {
  chatId: string | null
  characterId: string | null
  trackedParticipantId: string | null
  trackedParticipantKind: ParticipantKind
  primaryContactZone: UserContactZone
  customContactZone: string
}

export interface RegenerateParticipantProfilePayload {
  chatId: string | null
  characterId: string | null
  participantKind: ParticipantKind
}

export type FrontendToBackendMessage =
  | { type: 'lummate.phase1.bootstrap'; payload: ChatScopedPayload }
  | { type: 'lummate.phase1.chat_changed'; payload: ChatScopedPayload }
  | { type: 'lummate.phase1.play_toggle'; payload: PlayTogglePayload }
  | { type: 'lummate.phase3.regenerate'; payload: RegeneratePayload }
  | { type: 'lummate.phase3.set_playback_mode'; payload: SetPlaybackModePayload }
  | { type: 'lummate.phase3.set_tracking_preferences'; payload: SetTrackingPreferencesPayload }
  | { type: 'lummate.phase5.regenerate_profile'; payload: RegenerateParticipantProfilePayload }
  | { type: 'lummate.settings.bootstrap'; payload: ChatScopedPayload }
  | { type: 'lummate.settings.save'; payload: SettingsSavePayload & { context: ChatScopedPayload } }

export type BackendToFrontendMessage =
  | { type: 'lummate.phase1.bootstrap_result'; payload: BootstrapPayload }
  | { type: 'lummate.phase1.session_state'; payload: BootstrapPayload }
  | { type: 'lummate.settings.bootstrap_result'; payload: SettingsBootstrapPayload }
  | { type: 'lummate.settings.save_result'; payload: SettingsBootstrapPayload }
  | { type: 'lummate.phase5.profile_result'; payload: ParticipantProfileBundle }
  | { type: 'lummate.phase1.error'; message: string }

export const DEFAULT_MECHANICAL_AXES: MechanicalAxes = {
  baselineStrengthBias: 0,
  baselineTempoBias: 0,
  rampAggression: 0,
  motionWeight: 0,
  endurance: 0,
  smoothness: 0,
  dominancePressure: 0,
  teasingTendency: 0,
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  parser: {
    parserConnectionId: null,
    primaryUserContactZone: 'genitals',
    customUserContactZone: '',
    deactivationThreshold: 3,
    fallbackBehavior: 'default_connection',
  },
  xtoysDelivery: {
    enabled: false,
    mode: 'action_trigger_compat',
    privateWebhookId: '',
    webhookBaseUrl: 'https://webhook.xtoys.app',
    requestTimeoutMs: 8000,
    maxIntensity: 100,
    maxRampSeconds: 10,
    stopActionName: 'stop',
    holdActionName: 'hold',
    resumeActionName: 'resume',
    panicStopActionName: 'panicstop',
    triggerFieldName: 'action',
    intensityFieldName: 'intensity',
    rampSecondsFieldName: 'seconds',
  },
  xtoysActionMappings: [],
  actionCalibrationPresets: [],
}

export const DEFAULT_CHAT_TRACKING_PREFERENCES: ChatTrackingPreferences = {
  trackedParticipantId: null,
  trackedParticipantKind: 'persona',
  primaryContactZone: 'genitals',
  customContactZone: '',
}

export const ALL_ACTION_TYPES: ActionType[] = [
  'tease',
  'finger',
  'stroke',
  'thrust',
  'suction',
  'grind',
  'pulse',
  'lick',
  'squeeze',
  'pause',
]

export const CALIBRATABLE_ACTION_TYPES: ActionType[] = ALL_ACTION_TYPES.filter(
  (actionType) => actionType !== 'pause',
)

export const CALIBRATION_EXECUTION_PROFILES: ExecutionProfile[] = [
  'intensity_direct',
  'pattern_scripted',
  'pattern_funscript',
  'composite_blend',
  'parallel_blend',
]

export const DEFAULT_PARSER_SESSION_STATE: ParserSessionState = {
  armed: false,
  consecutiveNonRelevantMessageCount: 0,
  lastRelevantMessageId: null,
  currentHeldStateRef: null,
  continuityMemory: {},
}

export const DEFAULT_RUNTIME_PLAN_BUFFER: RuntimePlanBuffer = {
  currentPlan: null,
  previousPlan: null,
}

export const DEFAULT_SCHEDULER_STATE: SchedulerState = {
  status: 'idle',
  activePlanMessageId: null,
  activeBeatIndex: null,
  activeBeatStartedAt: null,
  playbackCycle: 0,
  lastCompletionReason: null,
  lastDispatchKind: null,
  lastDispatchAction: null,
  lastDispatchAt: null,
  lastDispatchStatus: null,
  lastDispatchError: null,
}

export const DEFAULT_HELD_STATE: HeldState = {
  actionFamily: null,
  resolvedActionPreset: null,
  resolvedExecutionProfile: 'unknown',
  contactZone: null,
  strength: 0,
  frequency: 0,
  persistence: null,
  actorContribution: 0,
  acteeContribution: 0,
  sourceMessageId: null,
  chatId: null,
  startedAt: null,
  lastUpdatedAt: null,
}

export const DEFAULT_SESSION_STATE: SessionState = {
  activeChatId: null,
  activeCharacterId: null,
  activeMessageId: null,
  lastPlayedMessageId: null,
  lastUpdatedAt: null,
  parserSession: DEFAULT_PARSER_SESSION_STATE,
  scheduler: DEFAULT_SCHEDULER_STATE,
  heldState: DEFAULT_HELD_STATE,
  runtimePlans: DEFAULT_RUNTIME_PLAN_BUFFER,
}

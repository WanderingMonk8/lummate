export type PlaybackMode = 'once' | 'loop' | 'hold'

export type ResponseMode = 'lead' | 'meet' | 'withdraw' | 'mutual'
export type ContinuityVerdict = 'continue' | 'progress' | 'modify' | 'replace' | 'stop'
export type TransitionMode = 'replace' | 'modulate' | 'blend'
export type DurationClass =
  | 'instant'
  | 'very_short'
  | 'short'
  | 'medium'
  | 'long'
  | 'extended'
  | 'ongoing'

export type ActionType =
  | 'tease'
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
  participantId: string
  displayName: string
  sourceFingerprint: string | null
  mechanicalAxes: MechanicalAxes
  userOverrides: Partial<MechanicalAxes>
  updatedAt: string | null
}

export interface ParticipantState {
  arousal: number
  energy: number
  steadiness: number
  focus: number
  provenance: 'parsed' | 'baseline'
  sourceMessageId: string | null
}

export interface ParserConnectionSettings {
  parserConnectionId: string | null
  deactivationThreshold: number
  fallbackBehavior: ParserConnectionFallback
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
  actionType: ActionType
  strength: number
  frequency: number
  durationClass: DurationClass
  durationMs: number
  persistence: string
  responseMode: ResponseMode
  actorWeight: number
  acteeWeight: number
  explicitChange: boolean
  explicitStop: boolean
}

export interface ResolvedBeat {
  messageId: string
  orderIndex: number
  actionType: ActionType
  xtoysActionName: string
  executionProfile: ExecutionProfile
  amplitude: number
  tempo: number
  durationMs: number
  persistence: string
}

export interface MessagePlan {
  messageId: string
  createdAt: string
  playbackMode: PlaybackMode
  semanticBeats: SemanticBeat[]
  resolvedBeats: ResolvedBeat[]
  continuityVerdict: ContinuityVerdict | null
  transitionMode: TransitionMode | null
}

export interface RuntimePlanBuffer {
  currentPlan: MessagePlan | null
  previousPlan: MessagePlan | null
}

export interface HeldState {
  actionFamily: ActionType | null
  resolvedActionPreset: ActionCalibrationPreset | null
  resolvedExecutionProfile: ExecutionProfile
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

export interface UserSettings {
  parser: ParserConnectionSettings
  xtoysActionMappings: XToysActionMappingSettings[]
  actionCalibrationPresets: ActionCalibrationPreset[]
}

export interface SessionState {
  activeChatId: string | null
  activeMessageId: string | null
  lastPlayedMessageId: string | null
  lastUpdatedAt: string | null
  parserSession: ParserSessionState
  heldState: HeldState
  runtimePlans: RuntimePlanBuffer
}

export interface BootstrapPayload {
  settings: UserSettings
  session: SessionState
}

export interface SettingsBootstrapPayload {
  settings: UserSettings
  availableConnections: ConnectionProfileSummary[]
}

export interface SettingsSavePayload {
  settings: UserSettings
}

export interface PlayTogglePayload {
  chatId: string | null
  messageId: string
}

export interface ChatScopedPayload {
  chatId: string | null
}

export type FrontendToBackendMessage =
  | { type: 'lummate.phase1.bootstrap'; payload: ChatScopedPayload }
  | { type: 'lummate.phase1.chat_changed'; payload: ChatScopedPayload }
  | { type: 'lummate.phase1.play_toggle'; payload: PlayTogglePayload }
  | { type: 'lummate.settings.bootstrap' }
  | { type: 'lummate.settings.save'; payload: SettingsSavePayload }

export type BackendToFrontendMessage =
  | { type: 'lummate.phase1.bootstrap_result'; payload: BootstrapPayload }
  | { type: 'lummate.phase1.session_state'; payload: BootstrapPayload }
  | { type: 'lummate.settings.bootstrap_result'; payload: SettingsBootstrapPayload }
  | { type: 'lummate.settings.save_result'; payload: SettingsBootstrapPayload }
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
    deactivationThreshold: 3,
    fallbackBehavior: 'default_connection',
  },
  xtoysActionMappings: [],
  actionCalibrationPresets: [],
}

export const ALL_ACTION_TYPES: ActionType[] = [
  'tease',
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

export const DEFAULT_HELD_STATE: HeldState = {
  actionFamily: null,
  resolvedActionPreset: null,
  resolvedExecutionProfile: 'unknown',
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
  activeMessageId: null,
  lastPlayedMessageId: null,
  lastUpdatedAt: null,
  parserSession: DEFAULT_PARSER_SESSION_STATE,
  heldState: DEFAULT_HELD_STATE,
  runtimePlans: DEFAULT_RUNTIME_PLAN_BUFFER,
}

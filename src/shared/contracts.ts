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

export type PlanStaleReason =
  | 'parser_connection_changed'
  | 'participant_profile_changed'
  | 'user_profile_changed'
  | 'action_calibration_changed'
  | 'duration_table_changed'
  | 'smoothing_changed'
  | 'safety_caps_changed'
  | 'manual_regeneration_requested'

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
  xtoysActionName: string
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
  revision: number
  createdAt: string
  playbackMode: PlaybackMode
  stale: boolean
  semanticBeats: SemanticBeat[]
  resolvedBeats: ResolvedBeat[]
  continuityVerdict: ContinuityVerdict | null
  transitionMode: TransitionMode | null
  staleReasons: PlanStaleReason[]
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
}

export interface SessionState {
  activeMessageId: string | null
  lastPlayedMessageId: string | null
  lastUpdatedAt: string | null
  parserSession: ParserSessionState
  heldState: HeldState
}

export interface BootstrapPayload {
  settings: UserSettings
  session: SessionState
}

export interface PlayTogglePayload {
  messageId: string
}

export type FrontendToBackendMessage =
  | { type: 'lummate.phase1.bootstrap' }
  | { type: 'lummate.phase1.play_toggle'; payload: PlayTogglePayload }

export type BackendToFrontendMessage =
  | { type: 'lummate.phase1.bootstrap_result'; payload: BootstrapPayload }
  | { type: 'lummate.phase1.session_state'; payload: BootstrapPayload }
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
}

export const DEFAULT_PARSER_SESSION_STATE: ParserSessionState = {
  armed: false,
  consecutiveNonRelevantMessageCount: 0,
  lastRelevantMessageId: null,
  currentHeldStateRef: null,
  continuityMemory: {},
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
  activeMessageId: null,
  lastPlayedMessageId: null,
  lastUpdatedAt: null,
  parserSession: DEFAULT_PARSER_SESSION_STATE,
  heldState: DEFAULT_HELD_STATE,
}

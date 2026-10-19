export const DEFAULT_MECHANICAL_AXES = {
    baselineStrengthBias: 0,
    baselineTempoBias: 0,
    rampAggression: 0,
    motionWeight: 0,
    endurance: 0,
    smoothness: 0,
    dominancePressure: 0,
    teasingTendency: 0,
};
export const DEFAULT_USER_SETTINGS = {
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
    ui: {
        debugOverlayEnabled: false,
    },
    xtoysActionMappings: [],
    actionCalibrationPresets: [],
};
export const DEFAULT_CHAT_TRACKING_PREFERENCES = {
    trackedParticipantId: null,
    trackedParticipantKind: 'persona',
    primaryContactZone: 'genitals',
    customContactZone: '',
    playbackMode: 'hold',
};
export const ALL_ACTION_TYPES = [
    'tease',
    'finger',
    'ride',
    'stroke',
    'thrust',
    'suction',
    'grind',
    'pulse',
    'lick',
    'squeeze',
    'pause',
];
export const CALIBRATABLE_ACTION_TYPES = ALL_ACTION_TYPES.filter((actionType) => actionType !== 'pause');
export const CALIBRATION_EXECUTION_PROFILES = [
    'intensity_direct',
    'pattern_scripted',
    'pattern_funscript',
    'composite_blend',
    'parallel_blend',
];
export const DEFAULT_PARSER_SESSION_STATE = {
    armed: false,
    consecutiveNonRelevantMessageCount: 0,
    lastRelevantMessageId: null,
    currentHeldStateRef: null,
    continuityMemory: {},
};
export const DEFAULT_RUNTIME_PLAN_BUFFER = {
    currentPlan: null,
    previousPlan: null,
};
export const DEFAULT_SCHEDULER_STATE = {
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
};
export const DEFAULT_HELD_STATE = {
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
};
export const DEFAULT_SESSION_STATE = {
    activeChatId: null,
    activeCharacterId: null,
    activeMessageId: null,
    lastPlayedMessageId: null,
    lastUpdatedAt: null,
    parserSession: DEFAULT_PARSER_SESSION_STATE,
    scheduler: DEFAULT_SCHEDULER_STATE,
    heldState: DEFAULT_HELD_STATE,
    runtimePlans: DEFAULT_RUNTIME_PLAN_BUFFER,
};

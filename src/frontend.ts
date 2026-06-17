import type {
  SpindleFrontendContext,
  SpindleFrontendModule,
  SpindleMountedComponent,
} from 'lumiverse-spindle-types'
import type {
  ActionType,
  BackendToFrontendMessage,
  BootstrapPayload,
  ChatTrackingPreferences,
  HeldState,
  MessagePlan,
  PlaybackMode,
  ParticipantKind,
  ParticipantProfile,
  ParticipantProfileBundle,
  ParserSessionState,
  SchedulerState,
  SettingsBootstrapPayload,
  UserContactZone,
  UserSettings,
} from './shared/contracts'

const CALIBRATABLE_ACTION_TYPES: ActionType[] = [
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
]

const CALIBRATION_EXECUTION_PROFILES = [
  'intensity_direct',
  'pattern_scripted',
  'pattern_funscript',
  'composite_blend',
  'parallel_blend',
] as const

const SHOW_PHASE4_DEBUG = true
const SHOW_PHASE5_DEBUG = true
const SHOW_PHASE6_DEBUG = true
const SHOW_PHASE7_DEBUG = true
const SHOW_XTOYS_ACTION_MAPPING_SETTINGS = false
const DEBUG_OVERLAY_SUPPORTED =
  SHOW_PHASE4_DEBUG || SHOW_PHASE5_DEBUG || SHOW_PHASE6_DEBUG || SHOW_PHASE7_DEBUG

const CONTROL_SELECTOR = '.lummate-phase1-control'
const ACTION_ROW_SELECTORS = [
  '[class*="actionsWrap"]',
  '[class*="actions_wrap"]',
  '[class^="_actionsWrap_"]',
  '[class^="_actions_wrap_"]',
  '[data-message-actions]',
  '[data-slot="message-actions"]',
  '[class*="message-actions"]',
  '[class*="messageActions"]',
  '[class*="actions-row"]',
  '[class*="actionRow"]',
  '[class*="toolbar"]',
]

function isBackendMessage(payload: unknown): payload is BackendToFrontendMessage {
  return typeof payload === 'object' && payload !== null && 'type' in payload
}

function isElement(value: unknown): value is Element {
  return value instanceof Element
}

function readPossibleMessageId(element: Element): string | null {
  const value =
    element.getAttribute('data-message-id') ??
    element.getAttribute('data-messageid') ??
    element.getAttribute('data-message') ??
    element.getAttribute('data-id')

  if (value && value.trim().length > 0) {
    return value.trim()
  }

  return null
}

function normalizeRoleCandidate(value: string | null | undefined): 'assistant' | 'user' | 'system' | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null

  if (normalized.includes('assistant') || normalized === 'ai' || normalized === 'bot') {
    return 'assistant'
  }

  if (normalized.includes('user') || normalized.includes('human') || normalized.includes('persona')) {
    return 'user'
  }

  if (normalized.includes('system')) {
    return 'system'
  }

  return null
}

function readPossibleMessageRole(element: Element): 'assistant' | 'user' | 'system' | null {
  const attributeCandidates = [
    element.getAttribute('data-role'),
    element.getAttribute('data-message-role'),
    element.getAttribute('data-author-role'),
    element.getAttribute('data-speaker-role'),
    element.getAttribute('data-owner'),
    element.getAttribute('aria-label'),
  ]

  for (const candidate of attributeCandidates) {
    const resolved = normalizeRoleCandidate(candidate)
    if (resolved) return resolved
  }

  const className =
    typeof (element as HTMLElement).className === 'string' ? (element as HTMLElement).className : ''
  const classResolved = normalizeRoleCandidate(className)
  if (classResolved) return classResolved

  return null
}

function isLikelyAssistantMessage(element: Element): boolean {
  let sawExplicitUserLikeRole = false

  let current: Element | null = element
  while (current) {
    const role = readPossibleMessageRole(current)
    if (role === 'assistant') return true
    if (role === 'user' || role === 'system') {
      sawExplicitUserLikeRole = true
    }
    current = current.parentElement
  }

  const scopedRoleCandidate = element.querySelector(
    '[data-role], [data-message-role], [data-author-role], [data-speaker-role]',
  )
  if (scopedRoleCandidate) {
    const role = readPossibleMessageRole(scopedRoleCandidate)
    if (role === 'assistant') return true
    if (role === 'user' || role === 'system') {
      sawExplicitUserLikeRole = true
    }
  }

  if (sawExplicitUserLikeRole) return false

  // Fall back permissively when the DOM exposes no stable role markers.
  // Older/newer Lumiverse builds vary here, and "unknown" used to be a
  // working path for the message action row injection.
  return true
}

export function setup(ctx: SpindleFrontendContext) {
  const injections = new Map<string, Element>()
  const buttons = new Map<string, HTMLButtonElement>()
  const menuButtons = new Map<string, HTMLButtonElement>()
  const statusLabels = new Map<string, HTMLElement>()
  const breakoutPanels = new Map<string, HTMLElement>()
  const targets = new Map<string, Element>()
  const settingsComponents: Array<SpindleMountedComponent<unknown>> = []

  let activeMessageId: string | null = null
  let activeChatId: string | null = ctx.getActiveChat().chatId
  let currentPlan: MessagePlan | null = null
  let currentHeldState: HeldState | null = null
  let currentSchedulerState: SchedulerState | null = null
  let openBreakoutMessageId: string | null = null
  let parserSessionState: ParserSessionState | null = null
  let settingsPayload: SettingsBootstrapPayload | null = null
  let participantProfiles: ParticipantProfileBundle | null = null
  let currentChatPreferences: ChatTrackingPreferences | null = null
  let draftSettings: UserSettings | null = null
  let settingsStatus = 'Loading settings...'
  let settingsSaveInFlight = false
  const playbackModeOverrides = new Map<string, PlaybackMode>()
  let longPressTimer: number | null = null
  let hoverOpenTimer: number | null = null
  let hoverCloseTimer: number | null = null
  const supportsHover =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
      : true

  const removeStyle = ctx.dom.addStyle(`
    .lummate-phase1-control {
      display: flex;
      align-items: center;
      margin-left: 6px;
      position: relative;
    }
    .lummate-phase1-button {
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: transparent;
      color: rgba(226, 232, 240, 0.95);
      border-radius: 8px;
      width: 28px;
      height: 28px;
      padding: 0;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
    }
    .lummate-phase1-button:hover {
      background: rgba(30, 41, 59, 0.45);
      border-color: rgba(148, 163, 184, 0.38);
    }
    .lummate-phase1-button[data-active="true"] {
      background: rgba(14, 116, 144, 0.22);
      color: #67e8f9;
      border-color: rgba(103, 232, 249, 0.45);
    }
    .lummate-phase1-button svg {
      width: 14px;
      height: 14px;
      display: block;
    }
    .lummate-phase1-menu-button {
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: transparent;
      color: rgba(191, 219, 254, 0.9);
      border-radius: 8px;
      width: 24px;
      height: 24px;
      margin-left: 4px;
      padding: 0;
      cursor: pointer;
    }
    .lummate-phase1-menu-button:hover {
      background: rgba(30, 41, 59, 0.42);
      border-color: rgba(148, 163, 184, 0.35);
    }
    .lummate-phase1-menu-button svg {
      width: 12px;
      height: 12px;
      display: block;
    }
    .lummate-phase1-status {
      display: none;
    }
    .lummate-phase1-breakout {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 220px;
      display: none;
      flex-direction: column;
      gap: 10px;
      padding: 10px;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      background: rgba(2, 6, 23, 0.96);
      box-shadow: 0 16px 30px rgba(2, 6, 23, 0.36);
      z-index: 30;
    }
    .lummate-phase1-breakout[data-open="true"] {
      display: flex;
    }
    .lummate-phase1-breakout-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: rgba(148, 163, 184, 0.9);
    }
    .lummate-phase1-breakout-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .lummate-phase1-breakout-action,
    .lummate-phase1-mode-button,
    .lummate-phase1-track-button {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.2);
      background: rgba(15, 23, 42, 0.78);
      color: rgba(226, 232, 240, 0.95);
      border-radius: 10px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .lummate-phase1-mode-button[data-active="true"] {
      background: rgba(14, 116, 144, 0.24);
      color: #67e8f9;
      border-color: rgba(103, 232, 249, 0.45);
    }
    .lummate-phase1-track-button[data-active="true"] {
      background: rgba(8, 47, 73, 0.72);
      color: #bae6fd;
      border-color: rgba(125, 211, 252, 0.4);
    }
    .lummate-phase1-breakout-action:hover,
    .lummate-phase1-mode-button:hover,
    .lummate-phase1-track-button:hover {
      border-color: rgba(148, 163, 184, 0.38);
    }
    .lummate-phase4-debug {
      position: fixed;
      left: 14px;
      bottom: 14px;
      z-index: 50;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 210px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: rgba(2, 6, 23, 0.92);
      color: rgba(226, 232, 240, 0.96);
      box-shadow: 0 14px 30px rgba(2, 6, 23, 0.26);
      font-size: 12px;
      line-height: 1.3;
      pointer-events: none;
    }
    .lummate-phase4-debug-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: rgba(148, 163, 184, 0.9);
    }
    .lummate-phase4-debug[data-armed="true"] {
      border-color: rgba(34, 197, 94, 0.35);
    }
    .lummate-phase4-debug[data-armed="false"] {
      border-color: rgba(148, 163, 184, 0.22);
    }
    .lummate-settings-root {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 16px;
      color: rgba(226, 232, 240, 0.96);
    }
    .lummate-settings-intro {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
      color: rgba(191, 219, 254, 0.82);
    }
    .lummate-settings-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.28);
    }
    .lummate-settings-section h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: rgba(248, 250, 252, 0.96);
    }
    .lummate-settings-section p {
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
      color: rgba(191, 219, 254, 0.78);
    }
    .lummate-settings-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .lummate-settings-field label {
      font-size: 12px;
      font-weight: 600;
      color: rgba(226, 232, 240, 0.94);
    }
    .lummate-settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .lummate-settings-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .lummate-profile-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
    }
    .lummate-profile-card {
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 14px;
      padding: 12px;
      background: rgba(15, 23, 42, 0.28);
    }
    .lummate-profile-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 10px;
    }
    .lummate-profile-card-header h4 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    .lummate-profile-card-subtitle,
    .lummate-profile-card-stamp {
      font-size: 11px;
      color: rgba(191, 219, 254, 0.72);
    }
    .lummate-profile-card-body {
      display: grid;
      gap: 8px;
      font-size: 12px;
    }
    .lummate-profile-card-preview {
      color: rgba(226, 232, 240, 0.88);
      line-height: 1.4;
    }
    .lummate-profile-card-axes {
      color: rgba(125, 211, 252, 0.9);
      font-size: 11px;
      line-height: 1.45;
    }
    .lummate-profile-regenerate {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: rgba(15, 23, 42, 0.52);
      color: rgba(226, 232, 240, 0.95);
      border-radius: 10px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .lummate-settings-save {
      appearance: none;
      border: 1px solid rgba(34, 197, 94, 0.4);
      background: rgba(22, 163, 74, 0.18);
      color: #dcfce7;
      border-radius: 10px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .lummate-settings-save:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .lummate-settings-status {
      font-size: 12px;
      color: rgba(191, 219, 254, 0.82);
    }
    .lummate-mapping-row {
      display: grid;
      grid-template-columns: minmax(110px, 140px) minmax(180px, 1fr) minmax(180px, 1fr) auto;
      gap: 10px;
      align-items: center;
    }
    .lummate-mapping-type {
      font-size: 12px;
      font-weight: 600;
      color: rgba(226, 232, 240, 0.9);
      text-transform: capitalize;
    }
    .lummate-settings-empty {
      font-size: 12px;
      color: rgba(191, 219, 254, 0.78);
    }
    .lummate-calibration-row {
      display: grid;
      grid-template-columns: minmax(110px, 140px) repeat(6, minmax(110px, 1fr));
      gap: 10px;
      align-items: center;
    }
  `)

  const debugIndicator = document.createElement('div')
  if (DEBUG_OVERLAY_SUPPORTED) {
    debugIndicator.className = 'lummate-phase4-debug'
    debugIndicator.dataset.armed = 'false'
    debugIndicator.innerHTML = `
      <div class="lummate-phase4-debug-title">Lummate Parser Session</div>
      <div class="lummate-phase4-debug-state">State: dormant</div>
      <div class="lummate-phase4-debug-count">Non-relevant count: 0</div>
      <div class="lummate-phase4-debug-message">Last relevant: none</div>
      <div class="lummate-phase4-debug-title">Phase 5 Profile Cache</div>
      <div class="lummate-phase5-debug-user">User profile: pending</div>
      <div class="lummate-phase5-debug-character">Character profile: pending</div>
      <div class="lummate-phase5-debug-fingerprint">Fingerprints: -- / --</div>
      <div class="lummate-phase4-debug-title">Phase 6 Current State</div>
      <div class="lummate-phase6-debug-zone">Primary zone: pending</div>
      <div class="lummate-phase6-debug-settings-zone">Settings zone: pending</div>
      <div class="lummate-phase6-debug-actor">Actor states: pending</div>
      <div class="lummate-phase6-debug-actee">Actee states: pending</div>
      <div class="lummate-phase4-debug-title">Phase 7 Parsed Actions</div>
      <div class="lummate-phase7-debug-source">Parser source: pending</div>
      <div class="lummate-phase7-debug-continuity">Continuity: pending</div>
      <div class="lummate-phase7-debug-held">Held: pending</div>
      <div class="lummate-phase7-debug-scheduler">Scheduler: pending</div>
      <div class="lummate-phase7-debug-semantic">Semantic beats: pending</div>
      <div class="lummate-phase7-debug-resolved">Resolved beats: pending</div>
      <div class="lummate-phase7-debug-trace">Sentence trace: pending</div>
    `
    document.body.appendChild(debugIndicator)
    debugIndicator.style.display = 'none'
  }

  const settingsTab = ctx.ui.registerDrawerTab({
    id: 'lummate-settings',
    title: 'Lummate Settings',
    shortName: 'Lummate',
    headerTitle: 'Lummate',
    description: 'Configure parser connection and XToys action mappings.',
    keywords: ['lummate', 'xtoys', 'parser', 'settings', 'tactile'],
    iconSvg: `
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" />
      </svg>
    `,
  })

  const inputAction = ctx.ui.registerInputBarAction({
    id: 'lummate-open-settings',
    label: 'Lummate',
    subtitle: 'XToys and parser settings',
    iconSvg: `
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" />
      </svg>
    `,
  })

  function formatProfileStatus(profile: ParticipantProfile | null, label: string) {
    if (!profile) return `${label}: unavailable`
    return `${label}: ${profile.displayName} (${profile.updatedAt ? 'cached' : 'uncached'}) - ${formatProfileTendencySummary(profile)}`
  }

  function formatCharacterProfilesStatus(profiles: ParticipantProfile[]) {
    if (profiles.length === 0) return 'Character profiles: unavailable'
    if (profiles.length === 1) {
      const [profile] = profiles
      return `Character profiles: ${profile.displayName} (${profile.updatedAt ? 'cached' : 'uncached'}) - ${formatProfileTendencySummary(profile)}`
    }
    return `Character profiles: ${profiles
      .map(
        (profile) =>
          `${profile.displayName} (${profile.updatedAt ? 'cached' : 'uncached'}; ${formatProfileTendencySummary(profile)})`,
      )
      .join(' | ')}`
  }

  function describeAxisTrend(
    value: number,
    positive: string,
    neutral: string,
    negative: string,
  ) {
    if (value >= 35) return positive
    if (value <= -35) return negative
    return neutral
  }

  function formatProfileTendencySummary(profile: ParticipantProfile) {
    const axes = profile.mechanicalAxes

    const strength = describeAxisTrend(
      axes.baselineStrengthBias,
      'strong',
      'balanced strength',
      'gentle',
    )
    const tempo = describeAxisTrend(
      axes.baselineTempoBias,
      'fast',
      'steady tempo',
      'slow',
    )
    const aggression = describeAxisTrend(
      axes.rampAggression,
      'aggressive',
      'measured',
      'restrained',
    )
    const smoothness = describeAxisTrend(
      axes.smoothness,
      'smooth',
      'mixed texture',
      'rough',
    )

    return [strength, tempo, aggression, smoothness].join(', ')
  }

  function formatParticipantStateAssignments(
    label: string,
    plan: MessagePlan | null,
    side: 'actor' | 'actee',
  ) {
    if (!plan) return `${label}: pending`

    const entries = plan.participantStates.filter((entry) => entry.side === side)
    if (entries.length === 0) return `${label}: none`

    return `${label}: ${entries
      .map(
        (entry) =>
          `${entry.displayName} ${formatParticipantStateSummary(entry.state)} (${entry.state.provenance}, w${entry.weight}, msg:${entry.state.sourceMessageId ?? 'none'})`,
      )
      .join(' | ')}`
  }

  function describeStateLevel(
    value: number,
    dimension: 'arousal' | 'energy' | 'steadiness' | 'focus',
  ) {
    if (dimension === 'arousal') {
      if (value >= 80) return 'highly aroused'
      if (value >= 65) return 'aroused'
      if (value >= 45) return 'steady'
      if (value >= 30) return 'muted'
      return 'low arousal'
    }

    if (dimension === 'energy') {
      if (value >= 80) return 'energized'
      if (value >= 65) return 'active'
      if (value >= 45) return 'baseline energy'
      if (value >= 30) return 'tired'
      return 'drained'
    }

    if (dimension === 'steadiness') {
      if (value >= 80) return 'very steady'
      if (value >= 65) return 'steady'
      if (value >= 45) return 'baseline steadiness'
      if (value >= 30) return 'shaky'
      return 'very shaky'
    }

    if (value >= 80) return 'highly focused'
    if (value >= 65) return 'focused'
    if (value >= 45) return 'baseline focus'
    if (value >= 30) return 'distracted'
    return 'unfocused'
  }

  function formatParticipantStateSummary(state: {
    arousal: number
    energy: number
    steadiness: number
    focus: number
  }) {
    return [
      `arousal ${describeStateLevel(state.arousal, 'arousal')} (${state.arousal})`,
      `energy ${describeStateLevel(state.energy, 'energy')} (${state.energy})`,
      `steadiness ${describeStateLevel(state.steadiness, 'steadiness')} (${state.steadiness})`,
      `focus ${describeStateLevel(state.focus, 'focus')} (${state.focus})`,
    ].join(', ')
  }

  function formatSemanticBeats(plan: MessagePlan | null) {
    if (!plan) return 'Semantic beats: pending'
    if (plan.semanticBeats.length === 0) return 'Semantic beats: none'

    return `Semantic beats: ${plan.semanticBeats
      .map(
        (beat) =>
          `${beat.orderIndex + 1}.${beat.actionType} s${beat.strength} f${beat.frequency} d${beat.durationMs}ms ${beat.durationClass} w${beat.actorWeight}/${beat.acteeWeight} ${beat.transitionStyle}/${beat.countHint} ${beat.responseMode} ${beat.fallbackBehavior}`,
      )
      .join(' | ')}`
  }

  function formatResolvedBeats(plan: MessagePlan | null) {
    if (!plan) return 'Resolved beats: pending'
    if (plan.resolvedBeats.length === 0) return 'Resolved beats: none'

    return `Resolved beats: ${plan.resolvedBeats
      .map(
        (beat) =>
          `${beat.orderIndex + 1}.${beat.actionType} -> ${beat.xtoysActionName || 'unmapped'} a${beat.amplitude} t${beat.tempo} d${beat.durationMs}ms ${beat.executionProfile} ${beat.transitionStyle}/${beat.countHint} ${beat.fallbackBehavior}`,
      )
      .join(' | ')}`
  }

  function splitDebugSentences(content: string) {
    return content
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
  }

  function formatSentenceTrace(plan: MessagePlan | null) {
    if (!plan) return 'Sentence trace: pending'
    if (plan.semanticBeats.length === 0) return 'Sentence trace: no relevant beats'

    const traceLines: string[] = []
    const sentencePool = new Set<string>()

    for (const beat of plan.semanticBeats) {
      const source = beat.sourceExcerpt?.trim() || ''
      if (!source) continue

      const sourceSentences = splitDebugSentences(source)
      if (sourceSentences.length === 0) {
        sourceSentences.push(source)
      }

      for (const sentence of sourceSentences) {
        const normalizedSentence = sentence.trim()
        if (!normalizedSentence) continue
        sentencePool.add(normalizedSentence)
      }
    }

    const sourceSentences = [...sentencePool]

    if (sourceSentences.length === 0) {
      return `Sentence trace: ${plan.semanticBeats
        .map((beat) => `${beat.orderIndex + 1}.${beat.actionType} <= ${beat.sourceExcerpt || '[no excerpt]'}`)
        .join(' | ')}`
    }

    for (const sentence of sourceSentences) {
      const normalizedSentence = sentence.toLowerCase()
      const matchingBeats = plan.semanticBeats.filter((beat) => {
        const excerpt = beat.sourceExcerpt?.toLowerCase() || ''
        return excerpt.includes(normalizedSentence) || normalizedSentence.includes(excerpt)
      })

      traceLines.push(
        `"${sentence}" => ${
          matchingBeats.length > 0
            ? matchingBeats
                .map(
                  (beat) =>
                    `${beat.orderIndex + 1}.${beat.actionType} s${beat.strength} f${beat.frequency} d${beat.durationMs}ms w${beat.actorWeight}/${beat.acteeWeight} ${beat.durationClass}`,
                )
                .join(', ')
            : 'no mapped beat'
        }`,
      )
    }

    const unmappedBeats = plan.semanticBeats.filter((beat) => {
      const excerpt = beat.sourceExcerpt?.trim()
      if (!excerpt) return true
      return !sourceSentences.some((sentence) => {
        const normalizedSentence = sentence.toLowerCase()
        const normalizedExcerpt = excerpt.toLowerCase()
        return normalizedExcerpt.includes(normalizedSentence) || normalizedSentence.includes(normalizedExcerpt)
      })
    })

    if (unmappedBeats.length > 0) {
      traceLines.push(
        `Unmapped beats: ${unmappedBeats
          .map((beat) => `${beat.orderIndex + 1}.${beat.actionType} <= ${beat.sourceExcerpt || '[no excerpt]'}`)
          .join(' | ')}`,
      )
    }

    return `Sentence trace: ${traceLines.join(' || ')}`
  }

  function updateMessageVisual(messageId: string) {
    const button = buttons.get(messageId)
    const status = statusLabels.get(messageId)
    if (!button || !status) return

    const isActive = activeMessageId === messageId
    button.dataset.active = isActive ? 'true' : 'false'
    button.title = isActive ? 'Stop actions' : 'Play actions'
    button.setAttribute('aria-label', isActive ? 'Stop actions' : 'Play actions')
    status.textContent = isActive ? 'Phase 1 active' : 'Phase 1 ready'
  }

  function syncVisuals() {
    for (const messageId of buttons.keys()) {
      updateMessageVisual(messageId)
    }
  }

  function getTrackableParticipants(): Array<{
    participantId: string | null
    participantKind: ParticipantKind
    label: string
  }> {
    const options: Array<{ participantId: string | null; participantKind: ParticipantKind; label: string }> = []

    if (participantProfiles?.userProfile) {
      options.push({
        participantId: participantProfiles.userProfile.participantId,
        participantKind: 'persona',
        label: participantProfiles.userProfile.displayName,
      })
    } else {
      options.push({
        participantId: null,
        participantKind: 'persona',
        label: 'User',
      })
    }

    for (const profile of participantProfiles?.characterProfiles ?? []) {
      options.push({
        participantId: profile.participantId,
        participantKind: 'character',
        label: profile.displayName,
      })
    }

    return options
  }

  function getCurrentTrackedParticipantLabel(): string {
    const trackableParticipants = getTrackableParticipants()
    const matched = trackableParticipants.find(
      (option) =>
        option.participantKind === currentChatPreferences?.trackedParticipantKind &&
        option.participantId === currentChatPreferences?.trackedParticipantId,
    )
    return matched?.label ?? (currentChatPreferences?.trackedParticipantKind === 'character' ? 'Character' : 'User')
  }

  function getCurrentTrackedZoneLabel(): string {
    if (!currentChatPreferences) return 'pending'
    return currentChatPreferences.primaryContactZone === 'custom'
      ? `custom (${currentChatPreferences.customContactZone || 'unset'})`
      : currentChatPreferences.primaryContactZone
  }

  function updateDebugIndicator() {
    if (!DEBUG_OVERLAY_SUPPORTED) return
    const shouldShow = Boolean(settingsPayload?.settings.ui.debugOverlayEnabled ?? draftSettings?.ui.debugOverlayEnabled)
    debugIndicator.style.display = shouldShow ? '' : 'none'
    if (!shouldShow) return

    const stateNode = debugIndicator.querySelector('.lummate-phase4-debug-state')
    const countNode = debugIndicator.querySelector('.lummate-phase4-debug-count')
    const messageNode = debugIndicator.querySelector('.lummate-phase4-debug-message')
    const userNode = debugIndicator.querySelector('.lummate-phase5-debug-user')
    const characterNode = debugIndicator.querySelector('.lummate-phase5-debug-character')
    const fingerprintNode = debugIndicator.querySelector('.lummate-phase5-debug-fingerprint')
    const zoneNode = debugIndicator.querySelector('.lummate-phase6-debug-zone')
    const settingsZoneNode = debugIndicator.querySelector('.lummate-phase6-debug-settings-zone')
    const actorStateNode = debugIndicator.querySelector('.lummate-phase6-debug-actor')
    const acteeStateNode = debugIndicator.querySelector('.lummate-phase6-debug-actee')
    const continuityNode = debugIndicator.querySelector('.lummate-phase7-debug-continuity')
    const heldNode = debugIndicator.querySelector('.lummate-phase7-debug-held')
    const schedulerNode = debugIndicator.querySelector('.lummate-phase7-debug-scheduler')
    const semanticNode = debugIndicator.querySelector('.lummate-phase7-debug-semantic')
    const resolvedNode = debugIndicator.querySelector('.lummate-phase7-debug-resolved')
    const traceNode = debugIndicator.querySelector('.lummate-phase7-debug-trace')
    const sourceNode = debugIndicator.querySelector('.lummate-phase7-debug-source')

    if (SHOW_PHASE4_DEBUG) {
      if (!parserSessionState) {
        debugIndicator.dataset.armed = 'false'
        if (stateNode) stateNode.textContent = 'State: dormant'
        if (countNode) countNode.textContent = 'Non-relevant count: 0'
        if (messageNode) messageNode.textContent = 'Last relevant: none'
      } else {
        debugIndicator.dataset.armed = parserSessionState.armed ? 'true' : 'false'
        if (stateNode) {
          stateNode.textContent = `State: ${parserSessionState.armed ? 'armed' : 'dormant'}`
        }
        if (countNode) {
          countNode.textContent = `Non-relevant count: ${parserSessionState.consecutiveNonRelevantMessageCount}`
        }
        if (messageNode) {
          messageNode.textContent = `Last relevant: ${parserSessionState.lastRelevantMessageId ?? 'none'}`
        }
      }
    } else {
      if (stateNode) stateNode.textContent = 'State: hidden'
      if (countNode) countNode.textContent = 'Non-relevant count: hidden'
      if (messageNode) messageNode.textContent = 'Last relevant: hidden'
    }

    if (SHOW_PHASE5_DEBUG) {
      const userProfile = participantProfiles?.userProfile ?? null
      const characterProfiles = participantProfiles?.characterProfiles ?? []
      if (userNode) {
        userNode.textContent = formatProfileStatus(userProfile, 'User profile')
      }
      if (characterNode) {
        characterNode.textContent = formatCharacterProfilesStatus(characterProfiles)
      }
      if (fingerprintNode) {
        fingerprintNode.textContent = `Fingerprints: ${userProfile?.sourceFingerprint?.slice(0, 8) ?? '--'} / ${characterProfiles.map((profile) => profile.sourceFingerprint?.slice(0, 8) ?? '--').join(', ') || '--'}`
      }
    }

    if (SHOW_PHASE6_DEBUG) {
      if (zoneNode) {
        zoneNode.textContent = `Tracked: ${getCurrentTrackedParticipantLabel()} / zone: ${getCurrentTrackedZoneLabel()}`
      }
      if (settingsZoneNode) {
        const savedZone =
          settingsPayload?.settings.parser.primaryUserContactZone ??
          'pending'
        const savedCustomZone =
          settingsPayload?.settings.parser.customUserContactZone ?? ''
        const draftZone =
          draftSettings?.parser.primaryUserContactZone ??
          'pending'
        const draftCustomZone =
          draftSettings?.parser.customUserContactZone ?? ''
        const formatZone = (zone: string, customZone: string) =>
          zone === 'custom' ? `custom (${customZone || 'unset'})` : zone
        settingsZoneNode.textContent = `Settings zone: saved ${formatZone(savedZone, savedCustomZone)} / draft ${formatZone(draftZone, draftCustomZone)}`
      }
      if (actorStateNode) {
        actorStateNode.textContent = formatParticipantStateAssignments(
          'Actor states',
          currentPlan,
          'actor',
        )
      }
      if (acteeStateNode) {
        acteeStateNode.textContent = formatParticipantStateAssignments(
          'Actee states',
          currentPlan,
          'actee',
        )
      }
    }

    if (SHOW_PHASE7_DEBUG) {
      if (sourceNode) {
        sourceNode.textContent = `Parser source: ${currentPlan?.parserSource ?? 'pending'}`
      }
      if (continuityNode) {
        continuityNode.textContent = `Continuity: ${currentPlan?.continuityVerdict ?? 'none'} / transition: ${currentPlan?.transitionMode ?? 'none'} / end: ${currentPlan?.endResolution ?? 'none'}`
      }
      if (heldNode) {
        heldNode.textContent = `Held: ${currentHeldState?.actionFamily ?? 'none'} @ ${currentHeldState?.contactZone ?? 'none'}`
      }
      if (schedulerNode) {
        schedulerNode.textContent = `Scheduler: ${currentSchedulerState?.status ?? 'none'} / plan: ${currentSchedulerState?.activePlanMessageId ?? 'none'} / beat: ${currentSchedulerState?.activeBeatIndex ?? 'none'} / cycle: ${currentSchedulerState?.playbackCycle ?? 0} / reason: ${currentSchedulerState?.lastCompletionReason ?? 'none'} / dispatch: ${currentSchedulerState?.lastDispatchKind ?? 'none'}:${currentSchedulerState?.lastDispatchAction ?? 'none'} (${currentSchedulerState?.lastDispatchStatus ?? 'none'})`
      }
      if (semanticNode) {
        semanticNode.textContent = formatSemanticBeats(currentPlan)
      }
      if (resolvedNode) {
        resolvedNode.textContent = formatResolvedBeats(currentPlan)
      }
      if (traceNode) {
        traceNode.textContent = formatSentenceTrace(currentPlan)
      }
    }
  }

  function closeBreakout() {
    openBreakoutMessageId = null
    for (const [messageId, panel] of breakoutPanels.entries()) {
      panel.dataset.open = messageId === openBreakoutMessageId ? 'true' : 'false'
    }
  }

  function openBreakout(messageId: string) {
    openBreakoutMessageId = messageId
    for (const [id, panel] of breakoutPanels.entries()) {
      panel.dataset.open = id === messageId ? 'true' : 'false'
    }
  }

  function clearHoverTimers() {
    if (hoverOpenTimer !== null) {
      window.clearTimeout(hoverOpenTimer)
      hoverOpenTimer = null
    }
    if (hoverCloseTimer !== null) {
      window.clearTimeout(hoverCloseTimer)
      hoverCloseTimer = null
    }
  }

  function scheduleBreakoutOpen(messageId: string) {
    if (hoverCloseTimer !== null) {
      window.clearTimeout(hoverCloseTimer)
      hoverCloseTimer = null
    }
    if (hoverOpenTimer !== null) {
      window.clearTimeout(hoverOpenTimer)
    }
    hoverOpenTimer = window.setTimeout(() => {
      openBreakout(messageId)
      updateBreakoutModeButtons(messageId)
      hoverOpenTimer = null
    }, 2000)
  }

  function scheduleBreakoutClose(messageId: string) {
    if (hoverOpenTimer !== null) {
      window.clearTimeout(hoverOpenTimer)
      hoverOpenTimer = null
    }
    if (hoverCloseTimer !== null) {
      window.clearTimeout(hoverCloseTimer)
    }
    hoverCloseTimer = window.setTimeout(() => {
      if (openBreakoutMessageId === messageId) {
        closeBreakout()
      }
      hoverCloseTimer = null
    }, 260)
  }

  function getPlaybackModeForMessage(messageId: string): PlaybackMode {
    const override = playbackModeOverrides.get(messageId)
    if (override) return override
    if (currentPlan?.messageId === messageId) return currentPlan.playbackMode
    return 'hold'
  }

  function syncActiveChat() {
    const activeChat = ctx.getActiveChat()
    const nextChatId = activeChat.chatId
    if (nextChatId === activeChatId) return

    activeChatId = nextChatId
    activeMessageId = null
    currentPlan = null
    currentHeldState = null
    currentSchedulerState = null
    parserSessionState = null
    currentChatPreferences = null
    syncVisuals()
    updateDebugIndicator()

    ctx.sendToBackend({
      type: 'lummate.phase1.chat_changed',
      payload: { chatId: activeChat.chatId, characterId: activeChat.characterId },
    })
    ctx.sendToBackend({
      type: 'lummate.settings.bootstrap',
      payload: { chatId: activeChat.chatId, characterId: activeChat.characterId },
    })
  }

  function getActiveChatContext() {
    const activeChat = ctx.getActiveChat()
    return {
      chatId: activeChat.chatId,
      characterId: activeChat.characterId,
    }
  }

  function cloneSettings(settings: UserSettings): UserSettings {
    return {
      parser: { ...settings.parser },
      xtoysDelivery: { ...settings.xtoysDelivery },
      ui: { ...settings.ui },
      xtoysActionMappings: settings.xtoysActionMappings.map((mapping) => ({ ...mapping })),
      actionCalibrationPresets: settings.actionCalibrationPresets.map((preset) => ({ ...preset })),
    }
  }

  function updateBreakoutModeButtons(messageId: string) {
    const panel = breakoutPanels.get(messageId)
    if (!panel) return

    const activeMode = getPlaybackModeForMessage(messageId)
    for (const element of panel.querySelectorAll('.lummate-phase1-mode-button')) {
      if (!(element instanceof HTMLButtonElement)) continue
      element.dataset.active = element.dataset.mode === activeMode ? 'true' : 'false'
    }
  }

  function updateBreakoutTrackingButtons(messageId: string) {
    const panel = breakoutPanels.get(messageId)
    if (!panel) return

    const row = panel.querySelector('.lummate-phase1-breakout-track-row') as HTMLElement | null
    if (!row) return

    row.textContent = ''
    for (const option of getTrackableParticipants()) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'lummate-phase1-track-button'
      button.dataset.participantId = option.participantId ?? ''
      button.dataset.participantKind = option.participantKind
      button.dataset.active =
        option.participantKind === currentChatPreferences?.trackedParticipantKind &&
        option.participantId === currentChatPreferences?.trackedParticipantId
          ? 'true'
          : 'false'
      button.textContent = option.label
      row.appendChild(button)
    }
  }

  function setSettingsStatus(nextStatus: string) {
    settingsStatus = nextStatus
    renderSettingsTab()
  }

  function clearSettingsComponents() {
    for (const component of settingsComponents) {
      component.destroy()
    }
    settingsComponents.length = 0
  }

  function registerSettingsComponent<T>(component: SpindleMountedComponent<T>) {
    settingsComponents.push(component as SpindleMountedComponent<unknown>)
    return component
  }

  function findMappingDraft(actionType: ActionType) {
    if (!draftSettings) return null
    return (
      draftSettings.xtoysActionMappings.find((mapping) => mapping.semanticActionType === actionType) ?? null
    )
  }

  function findCalibrationDraft(actionType: ActionType) {
    if (!draftSettings) return null
    return (
      draftSettings.actionCalibrationPresets.find((preset) => preset.semanticActionType === actionType) ??
      null
    )
  }

  function sendSettingsSave() {
    if (!draftSettings || settingsSaveInFlight) return
    settingsSaveInFlight = true
    setSettingsStatus('Saving settings...')
    ctx.sendToBackend({
      type: 'lummate.settings.save',
      payload: {
        settings: draftSettings,
        context: getActiveChatContext(),
      },
    })
  }

  function buildProfileAxesSummary(profile: ParticipantProfile) {
    return [
      `str ${profile.mechanicalAxes.baselineStrengthBias}`,
      `tmp ${profile.mechanicalAxes.baselineTempoBias}`,
      `agg ${profile.mechanicalAxes.rampAggression}`,
      `wgt ${profile.mechanicalAxes.motionWeight}`,
      `end ${profile.mechanicalAxes.endurance}`,
      `smth ${profile.mechanicalAxes.smoothness}`,
      `dom ${profile.mechanicalAxes.dominancePressure}`,
      `tease ${profile.mechanicalAxes.teasingTendency}`,
    ].join(' · ')
  }

  function createProfileCard(
    title: string,
    profile: ParticipantProfile | null,
    participantKind: 'character' | 'persona',
  ) {
    const card = document.createElement('div')
    card.className = 'lummate-profile-card'

    const header = document.createElement('div')
    header.className = 'lummate-profile-card-header'

    const titleBlock = document.createElement('div')
    const heading = document.createElement('h4')
    heading.textContent = title
    titleBlock.appendChild(heading)

    const subtitle = document.createElement('div')
    subtitle.className = 'lummate-profile-card-subtitle'
    subtitle.textContent = profile
      ? `${profile.displayName} · ${profile.sourceFingerprint?.slice(0, 8) ?? 'no-fp'}`
      : 'No source available'
    titleBlock.appendChild(subtitle)
    header.appendChild(titleBlock)

    const regenerateButton = document.createElement('button')
    regenerateButton.type = 'button'
    regenerateButton.className = 'lummate-profile-regenerate'
    regenerateButton.textContent = 'Regenerate'
    regenerateButton.disabled = settingsSaveInFlight
    regenerateButton.addEventListener('click', () => {
      setSettingsStatus(`Regenerating ${participantKind === 'persona' ? 'user' : 'character'} profile...`)
      ctx.sendToBackend({
        type: 'lummate.phase5.regenerate_profile',
        payload: {
          ...getActiveChatContext(),
          participantKind,
        },
      })
    })
    header.appendChild(regenerateButton)
    card.appendChild(header)

    const body = document.createElement('div')
    body.className = 'lummate-profile-card-body'
    if (!profile) {
      body.textContent =
        participantKind === 'persona'
          ? 'No active or default persona is available for profile derivation.'
          : 'No active character is attached to this chat.'
    } else {
      const preview = document.createElement('div')
      preview.className = 'lummate-profile-card-preview'
      preview.textContent = profile.sourcePreview || 'No source preview available.'
      body.appendChild(preview)

      const axes = document.createElement('div')
      axes.className = 'lummate-profile-card-axes'
      axes.textContent = buildProfileAxesSummary(profile)
      body.appendChild(axes)

      const stamp = document.createElement('div')
      stamp.className = 'lummate-profile-card-stamp'
      stamp.textContent = `Derived ${profile.updatedAt ?? 'unknown'}`
      body.appendChild(stamp)
    }
    card.appendChild(body)

    return card
  }

  function createCharacterProfilesCard(title: string, profiles: ParticipantProfile[]) {
    const card = document.createElement('div')
    card.className = 'lummate-profile-card'

    const header = document.createElement('div')
    header.className = 'lummate-profile-card-header'

    const titleBlock = document.createElement('div')
    const heading = document.createElement('h4')
    heading.textContent = title
    titleBlock.appendChild(heading)

    const subtitle = document.createElement('div')
    subtitle.className = 'lummate-profile-card-subtitle'
    subtitle.textContent =
      profiles.length === 0
        ? 'No character profiles available'
        : profiles.length === 1
          ? '1 character profile cached'
          : `${profiles.length} character profiles cached`
    titleBlock.appendChild(subtitle)
    header.appendChild(titleBlock)

    const regenerateButton = document.createElement('button')
    regenerateButton.type = 'button'
    regenerateButton.className = 'lummate-profile-regenerate'
    regenerateButton.textContent = 'Regenerate'
    regenerateButton.disabled = settingsSaveInFlight
    regenerateButton.addEventListener('click', () => {
      setSettingsStatus('Regenerating character profiles...')
      ctx.sendToBackend({
        type: 'lummate.phase5.regenerate_profile',
        payload: {
          ...getActiveChatContext(),
          participantKind: 'character',
        },
      })
    })
    header.appendChild(regenerateButton)
    card.appendChild(header)

    const body = document.createElement('div')
    body.className = 'lummate-profile-card-body'

    if (profiles.length === 0) {
      body.textContent =
        'No active character profiles are available for this chat. In group chats, this means Lumiverse did not expose a participant roster beyond the primary character.'
    } else {
      for (const profile of profiles) {
        const block = document.createElement('div')
        block.className = 'lummate-profile-card-preview'
        block.textContent = `${profile.displayName} · ${profile.sourceFingerprint?.slice(0, 8) ?? 'no-fp'}`
        body.appendChild(block)

        const axes = document.createElement('div')
        axes.className = 'lummate-profile-card-axes'
        axes.textContent = buildProfileAxesSummary(profile)
        body.appendChild(axes)
      }
    }

    card.appendChild(body)
    return card
  }

  function createField(container: HTMLElement, labelText: string) {
    const field = document.createElement('div')
    field.className = 'lummate-settings-field'
    const label = document.createElement('label')
    label.textContent = labelText
    const mount = document.createElement('div')
    field.append(label, mount)
    container.appendChild(field)
    return mount
  }

  function renderSettingsTab() {
    clearSettingsComponents()
    settingsTab.root.innerHTML = ''

    const root = document.createElement('div')
    root.className = 'lummate-settings-root'

    const intro = document.createElement('p')
    intro.className = 'lummate-settings-intro'
    intro.textContent =
      'Choose a cheaper Lumiverse parser connection and define the XToys action names your own XToys script responds to.'
    root.appendChild(intro)

    if (!draftSettings || !settingsPayload) {
      const empty = document.createElement('div')
      empty.className = 'lummate-settings-empty'
      empty.textContent = settingsStatus
      root.appendChild(empty)
      settingsTab.root.appendChild(root)
      return
    }

    const parserSection = document.createElement('section')
    parserSection.className = 'lummate-settings-section'
    parserSection.innerHTML = `
      <h3>Parser</h3>
      <p>Use a dedicated Lumiverse connection for scene parsing so the extension does not need to burn your main roleplay model.</p>
    `

    const parserGrid = document.createElement('div')
    parserGrid.className = 'lummate-settings-grid'
    parserSection.appendChild(parserGrid)

    const connectionMount = createField(parserGrid, 'Parser connection')
    registerSettingsComponent(
      ctx.components.mountSelect(connectionMount, {
        options: settingsPayload.availableConnections.map((connection) => ({
          value: connection.id,
          label: connection.name,
          sublabel: `${connection.provider} · ${connection.model}${connection.isDefault ? ' · Default' : ''}`,
        })),
        value: draftSettings.parser.parserConnectionId ?? '',
        placeholder: 'Use Lumiverse default connection',
        clearable: true,
        clearLabel: 'Use default connection',
        onChange: (value) => {
          if (!draftSettings) return
          draftSettings.parser.parserConnectionId = value || null
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const thresholdMount = createField(parserGrid, 'Auto-disarm threshold')
    registerSettingsComponent(
      ctx.components.mountNumberStepper(thresholdMount, {
        value: draftSettings.parser.deactivationThreshold,
        min: 1,
        max: 10,
        step: 1,
        onChange: (value) => {
          if (!draftSettings || value == null) return
          draftSettings.parser.deactivationThreshold = value
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const fallbackMount = createField(parserGrid, 'Fallback behavior')
    registerSettingsComponent(
      ctx.components.mountSelect(fallbackMount, {
        options: [
          {
            value: 'default_connection',
            label: 'Use default connection',
            sublabel: 'Fall back to the user default if no parser connection is selected.',
          },
          {
            value: 'fail_closed',
            label: 'Fail closed',
            sublabel: 'Refuse parsing until a parser connection is explicitly configured.',
          },
        ],
        value: draftSettings.parser.fallbackBehavior,
        onChange: (value) => {
          if (!draftSettings || (value !== 'default_connection' && value !== 'fail_closed')) return
          draftSettings.parser.fallbackBehavior = value
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const contactZoneMount = createField(parserGrid, 'Default tracked contact zone')
    registerSettingsComponent(
      ctx.components.mountSelect(contactZoneMount, {
        options: [
          { value: 'genitals', label: 'Genitals' },
          { value: 'anus', label: 'Anus' },
          { value: 'mouth', label: 'Mouth' },
          { value: 'custom', label: 'Custom' },
        ],
        value: draftSettings.parser.primaryUserContactZone,
        onChange: (value) => {
          if (!draftSettings) return
          if (value !== 'genitals' && value !== 'anus' && value !== 'mouth' && value !== 'custom') return
          draftSettings.parser.primaryUserContactZone = value as UserContactZone
          setSettingsStatus('Unsaved changes')
          updateDebugIndicator()
        },
      }),
    )

    if (draftSettings.parser.primaryUserContactZone === 'custom') {
      const customZoneMount = createField(
        parserGrid,
        'Custom tracked-zone terms',
      )
      registerSettingsComponent(
        ctx.components.mountTextInput(customZoneMount, {
          value: draftSettings.parser.customUserContactZone,
          placeholder: 'Example: anus, asshole, rear',
          ariaLabel: 'Custom tracked contact zone terms',
          onChange: (value) => {
            if (!draftSettings) return
            draftSettings.parser.customUserContactZone = value.trim()
            setSettingsStatus('Unsaved changes')
            updateDebugIndicator()
          },
        }),
      )
    }

    root.appendChild(parserSection)

    const profileSection = document.createElement('section')
    profileSection.className = 'lummate-settings-section'
    profileSection.innerHTML = `
      <h3>Participant Profiles</h3>
      <p>These cached tactile profiles are derived from the active user persona and the current chat character, then reused across later planning work.</p>
    `

    const profileGrid = document.createElement('div')
    profileGrid.className = 'lummate-profile-grid'
    profileGrid.appendChild(
      createProfileCard('User Persona Profile', participantProfiles?.userProfile ?? null, 'persona'),
    )
    profileGrid.appendChild(
      createCharacterProfilesCard(
        'Character Profiles',
        participantProfiles?.characterProfiles ?? [],
      ),
    )
    profileSection.appendChild(profileGrid)
    root.appendChild(profileSection)

    const deliverySection = document.createElement('section')
    deliverySection.className = 'lummate-settings-section'
    deliverySection.innerHTML = `
      <h3>XToys Delivery</h3>
      <p>XToys private webhooks use a saved Webhook ID. Lummate sends one beat or control event at a time using XToys-compatible query-string webhook requests, with one base action trigger plus per-beat <code>intensity</code> and <code>seconds</code> values.</p>
    `

    const deliveryGrid = document.createElement('div')
    deliveryGrid.className = 'lummate-settings-grid'
    deliverySection.appendChild(deliveryGrid)

    const deliveryEnabledMount = createField(deliveryGrid, 'Enable XToys delivery')
    registerSettingsComponent(
      ctx.components.mountSwitch(deliveryEnabledMount, {
        checked: draftSettings.xtoysDelivery.enabled,
        ariaLabel: 'Enable XToys webhook delivery',
        onChange: (checked) => {
          if (!draftSettings) return
          draftSettings.xtoysDelivery.enabled = checked
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const webhookIdMount = createField(deliveryGrid, 'Private webhook ID')
    registerSettingsComponent(
      ctx.components.mountTextInput(webhookIdMount, {
        value: draftSettings.xtoysDelivery.privateWebhookId,
        placeholder: 'Example: mtIxeqcvxmDC',
        ariaLabel: 'XToys private webhook ID',
        onChange: (value) => {
          if (!draftSettings) return
          draftSettings.xtoysDelivery.privateWebhookId = value.trim()
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const baseUrlMount = createField(deliveryGrid, 'Webhook base URL')
    registerSettingsComponent(
      ctx.components.mountTextInput(baseUrlMount, {
        value: draftSettings.xtoysDelivery.webhookBaseUrl,
        placeholder: 'https://webhook.xtoys.app',
        ariaLabel: 'XToys webhook base URL',
        onChange: (value) => {
          if (!draftSettings) return
          draftSettings.xtoysDelivery.webhookBaseUrl = value.trim() || 'https://webhook.xtoys.app'
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const timeoutMount = createField(deliveryGrid, 'Request timeout (ms)')
    registerSettingsComponent(
      ctx.components.mountNumberStepper(timeoutMount, {
        value: draftSettings.xtoysDelivery.requestTimeoutMs,
        min: 1000,
        max: 30000,
        step: 500,
        onChange: (value) => {
          if (!draftSettings || value == null) return
          draftSettings.xtoysDelivery.requestTimeoutMs = value
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const maxIntensityMount = createField(deliveryGrid, 'Global intensity cap')
    registerSettingsComponent(
      ctx.components.mountNumberStepper(maxIntensityMount, {
        value: draftSettings.xtoysDelivery.maxIntensity,
        min: 0,
        max: 100,
        step: 1,
        onChange: (value) => {
          if (!draftSettings || value == null) return
          draftSettings.xtoysDelivery.maxIntensity = value
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const maxRampMount = createField(deliveryGrid, 'Max ramp time (seconds)')
    registerSettingsComponent(
      ctx.components.mountNumberStepper(maxRampMount, {
        value: draftSettings.xtoysDelivery.maxRampSeconds,
        min: 0,
        max: 30,
        step: 0.1,
        onChange: (value) => {
          if (!draftSettings || value == null) return
          draftSettings.xtoysDelivery.maxRampSeconds = value
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const triggerFieldMount = createField(deliveryGrid, 'Trigger field name')
    registerSettingsComponent(
      ctx.components.mountTextInput(triggerFieldMount, {
        value: draftSettings.xtoysDelivery.triggerFieldName,
        placeholder: 'action',
        ariaLabel: 'XToys trigger field name',
        onChange: (value) => {
          if (!draftSettings) return
          draftSettings.xtoysDelivery.triggerFieldName = value.trim() || 'action'
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const intensityFieldMount = createField(deliveryGrid, 'Intensity field name')
    registerSettingsComponent(
      ctx.components.mountTextInput(intensityFieldMount, {
        value: draftSettings.xtoysDelivery.intensityFieldName,
        placeholder: 'intensity',
        ariaLabel: 'XToys intensity field name',
        onChange: (value) => {
          if (!draftSettings) return
          draftSettings.xtoysDelivery.intensityFieldName = value.trim() || 'intensity'
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const rampFieldMount = createField(deliveryGrid, 'Ramp seconds field name')
    registerSettingsComponent(
      ctx.components.mountTextInput(rampFieldMount, {
        value: draftSettings.xtoysDelivery.rampSecondsFieldName,
        placeholder: 'seconds',
        ariaLabel: 'XToys ramp seconds field name',
        onChange: (value) => {
          if (!draftSettings) return
          draftSettings.xtoysDelivery.rampSecondsFieldName = value.trim() || 'seconds'
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const stopActionMount = createField(deliveryGrid, 'Stop action name')
    registerSettingsComponent(
      ctx.components.mountTextInput(stopActionMount, {
        value: draftSettings.xtoysDelivery.stopActionName,
        placeholder: 'stop',
        ariaLabel: 'XToys stop action name',
        onChange: (value) => {
          if (!draftSettings) return
          draftSettings.xtoysDelivery.stopActionName = value.trim() || 'stop'
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const holdActionMount = createField(deliveryGrid, 'Hold action name')
    registerSettingsComponent(
      ctx.components.mountTextInput(holdActionMount, {
        value: draftSettings.xtoysDelivery.holdActionName,
        placeholder: 'hold',
        ariaLabel: 'XToys hold action name',
        onChange: (value) => {
          if (!draftSettings) return
          draftSettings.xtoysDelivery.holdActionName = value.trim() || 'hold'
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const resumeActionMount = createField(deliveryGrid, 'Resume action name')
    registerSettingsComponent(
      ctx.components.mountTextInput(resumeActionMount, {
        value: draftSettings.xtoysDelivery.resumeActionName,
        placeholder: 'resume',
        ariaLabel: 'XToys resume action name',
        onChange: (value) => {
          if (!draftSettings) return
          draftSettings.xtoysDelivery.resumeActionName = value.trim() || 'resume'
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    const panicActionMount = createField(deliveryGrid, 'Panic-stop action name')
    registerSettingsComponent(
      ctx.components.mountTextInput(panicActionMount, {
        value: draftSettings.xtoysDelivery.panicStopActionName,
        placeholder: 'panicstop',
        ariaLabel: 'XToys panic stop action name',
        onChange: (value) => {
          if (!draftSettings) return
          draftSettings.xtoysDelivery.panicStopActionName = value.trim() || 'panicstop'
          setSettingsStatus('Unsaved changes')
        },
      }),
    )

    root.appendChild(deliverySection)

    if (SHOW_XTOYS_ACTION_MAPPING_SETTINGS) {
      const mappingsSection = document.createElement('section')
      mappingsSection.className = 'lummate-settings-section'
      mappingsSection.innerHTML = `
        <h3>XToys Action Mapping</h3>
        <p>Each semantic action type maps to a base XToys action name. Lummate will automatically emit <code>name-low</code>, <code>name-medium</code>, or <code>name-high</code> based on the resolved beat intensity.</p>
      `

      for (const mapping of draftSettings.xtoysActionMappings) {
        const row = document.createElement('div')
        row.className = 'lummate-mapping-row'

        const typeCell = document.createElement('div')
        typeCell.className = 'lummate-mapping-type'
        typeCell.textContent = mapping.semanticActionType
        row.appendChild(typeCell)

        const actionMount = document.createElement('div')
        row.appendChild(actionMount)
        registerSettingsComponent(
          ctx.components.mountTextInput(actionMount, {
            value: mapping.xtoysActionName,
            placeholder: 'XToys action name',
            ariaLabel: `${mapping.semanticActionType} XToys action name`,
            onChange: (value) => {
              const target = findMappingDraft(mapping.semanticActionType)
              if (!target) return
              target.xtoysActionName = value.trim()
              target.updatedAt = new Date().toISOString()
              setSettingsStatus('Unsaved changes')
            },
          }),
        )

        const fallbackActionMount = document.createElement('div')
        row.appendChild(fallbackActionMount)
        registerSettingsComponent(
          ctx.components.mountTextInput(fallbackActionMount, {
            value: mapping.fallbackActionName ?? '',
            placeholder: 'Fallback action name (optional)',
            ariaLabel: `${mapping.semanticActionType} fallback XToys action name`,
            onChange: (value) => {
              const target = findMappingDraft(mapping.semanticActionType)
              if (!target) return
              target.fallbackActionName = value.trim() || null
              target.updatedAt = new Date().toISOString()
              setSettingsStatus('Unsaved changes')
            },
          }),
        )

        const supportMount = document.createElement('div')
        row.appendChild(supportMount)
        registerSettingsComponent(
          ctx.components.mountSwitch(supportMount, {
            checked: mapping.supported,
            ariaLabel: `${mapping.semanticActionType} supported`,
            onChange: (checked) => {
              const target = findMappingDraft(mapping.semanticActionType)
              if (!target) return
              target.supported = checked
              target.updatedAt = new Date().toISOString()
              setSettingsStatus('Unsaved changes')
            },
          }),
        )

        mappingsSection.appendChild(row)
      }

      root.appendChild(mappingsSection)
    }

    const calibrationSection = document.createElement('section')
    calibrationSection.className = 'lummate-settings-section'
    calibrationSection.innerHTML = `
      <h3>Tactile Calibration</h3>
      <p>These are Lumiverse-side semantic baselines only. They tune how each action type should feel before any XToys-specific runtime logic exists.</p>
    `

    for (const actionType of CALIBRATABLE_ACTION_TYPES) {
      const preset = findCalibrationDraft(actionType)
      if (!preset) continue

      const row = document.createElement('div')
      row.className = 'lummate-calibration-row'

      const typeCell = document.createElement('div')
      typeCell.className = 'lummate-mapping-type'
      typeCell.textContent = actionType
      row.appendChild(typeCell)

      const amplitudeMount = document.createElement('div')
      row.appendChild(amplitudeMount)
      registerSettingsComponent(
        ctx.components.mountNumberStepper(amplitudeMount, {
          value: preset.baseAmplitude,
          min: 0,
          max: 100,
          step: 1,
          onChange: (value) => {
            const target = findCalibrationDraft(actionType)
            if (!target || value == null) return
            target.baseAmplitude = value
            target.revision += 1
            setSettingsStatus('Unsaved changes')
          },
        }),
      )

      const tempoMount = document.createElement('div')
      row.appendChild(tempoMount)
      registerSettingsComponent(
        ctx.components.mountNumberStepper(tempoMount, {
          value: preset.baseTempo,
          min: 0,
          max: 100,
          step: 1,
          onChange: (value) => {
            const target = findCalibrationDraft(actionType)
            if (!target || value == null) return
            target.baseTempo = value
            target.revision += 1
            setSettingsStatus('Unsaved changes')
          },
        }),
      )

      const holdMount = document.createElement('div')
      row.appendChild(holdMount)
      registerSettingsComponent(
        ctx.components.mountNumberStepper(holdMount, {
          value: preset.holdTendency,
          min: 0,
          max: 100,
          step: 1,
          onChange: (value) => {
            const target = findCalibrationDraft(actionType)
            if (!target || value == null) return
            target.holdTendency = value
            target.revision += 1
            setSettingsStatus('Unsaved changes')
          },
        }),
      )

      const executionMount = document.createElement('div')
      row.appendChild(executionMount)
      registerSettingsComponent(
        ctx.components.mountSelect(executionMount, {
          options: CALIBRATION_EXECUTION_PROFILES.map((profile) => ({
            value: profile,
            label: profile,
          })),
          value: preset.preferredExecutionProfile,
          onChange: (value) => {
            const target = findCalibrationDraft(actionType)
            if (!target || !CALIBRATION_EXECUTION_PROFILES.includes(value as never)) return
            target.preferredExecutionProfile = value as (typeof CALIBRATION_EXECUTION_PROFILES)[number]
            target.revision += 1
            setSettingsStatus('Unsaved changes')
          },
        }),
      )

      const repeatMount = document.createElement('div')
      row.appendChild(repeatMount)
      registerSettingsComponent(
        ctx.components.mountSelect(repeatMount, {
          options: [
            { value: 'once', label: 'Play once' },
            { value: 'loop', label: 'Loop' },
            { value: 'hold', label: 'Hold final' },
          ],
          value: preset.repeatStyle,
          onChange: (value) => {
            const target = findCalibrationDraft(actionType)
            if (!target || (value !== 'once' && value !== 'loop' && value !== 'hold')) return
            target.repeatStyle = value
            target.revision += 1
            setSettingsStatus('Unsaved changes')
          },
        }),
      )

      const fallbackMount = document.createElement('div')
      row.appendChild(fallbackMount)
      registerSettingsComponent(
        ctx.components.mountSelect(fallbackMount, {
          options: [
            { value: '', label: 'No fallback' },
            ...CALIBRATABLE_ACTION_TYPES.filter((candidate) => candidate !== actionType).map((candidate) => ({
              value: candidate,
              label: candidate,
            })),
          ],
          value: preset.fallbackTarget ?? '',
          onChange: (value) => {
            const target = findCalibrationDraft(actionType)
            if (!target) return
            target.fallbackTarget = value ? (value as ActionType) : null
            target.revision += 1
            setSettingsStatus('Unsaved changes')
          },
        }),
      )

      const supportMount = document.createElement('div')
      row.appendChild(supportMount)
      registerSettingsComponent(
        ctx.components.mountSwitch(supportMount, {
          checked: preset.supported,
          ariaLabel: `${actionType} calibration supported`,
          onChange: (checked) => {
            const target = findCalibrationDraft(actionType)
            if (!target) return
            target.supported = checked
            target.revision += 1
            setSettingsStatus('Unsaved changes')
          },
        }),
      )

      calibrationSection.appendChild(row)
    }

    root.appendChild(calibrationSection)

    if (DEBUG_OVERLAY_SUPPORTED) {
      const debugSection = document.createElement('section')
      debugSection.className = 'lummate-settings-section'
      debugSection.innerHTML = `
        <h3>Debug</h3>
        <p>Enable the parser debug overlay when you need to inspect tracked states, parsed beats, and scheduler output.</p>
      `

      const debugToggleMount = document.createElement('div')
      debugSection.appendChild(debugToggleMount)
      registerSettingsComponent(
        ctx.components.mountSwitch(debugToggleMount, {
          checked: draftSettings.ui.debugOverlayEnabled,
          ariaLabel: 'Enable parser debug overlay',
          onChange: (checked) => {
            if (!draftSettings) return
            draftSettings.ui.debugOverlayEnabled = checked
            setSettingsStatus('Unsaved changes')
            updateDebugIndicator()
          },
        }),
      )

      root.appendChild(debugSection)
    }

    const actions = document.createElement('div')
    actions.className = 'lummate-settings-actions'

    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.className = 'lummate-settings-save'
    saveButton.textContent = settingsSaveInFlight ? 'Saving...' : 'Save settings'
    saveButton.disabled = settingsSaveInFlight
    saveButton.addEventListener('click', sendSettingsSave)
    actions.appendChild(saveButton)

    const status = document.createElement('div')
    status.className = 'lummate-settings-status'
    status.textContent = settingsStatus
    actions.appendChild(status)

    root.appendChild(actions)
    settingsTab.root.appendChild(root)
  }

  function resolveMessageIdFromNode(node: Element): string | null {
    const domHelper = ctx.dom as unknown as Record<string, unknown>
    const getMessageId = domHelper.getMessageId

    let current: Element | null = node
    while (current) {
      const fromAttributes = readPossibleMessageId(current)
      if (fromAttributes) return fromAttributes

      if (typeof getMessageId === 'function') {
        const resolved = getMessageId.call(ctx.dom, current) as unknown
        if (typeof resolved === 'string' && resolved.length > 0) {
          return resolved
        }
      }

      current = current.parentElement
    }

    return null
  }

  function getVisibleMessageTargets(): Array<{ messageId: string; element: Element }> {
    const found = new Map<string, Element>()
    const domHelper = ctx.dom as unknown as Record<string, unknown>
    const messagesApi = ctx.messages as unknown as Record<string, unknown>

    const listMessageElements = domHelper.listMessageElements
    if (typeof listMessageElements === 'function') {
      const mounted = listMessageElements.call(ctx.dom) as unknown
      if (Array.isArray(mounted)) {
        for (const entry of mounted) {
          if (
            typeof entry === 'object' &&
            entry !== null &&
            'messageId' in entry &&
            typeof (entry as { messageId?: unknown }).messageId === 'string' &&
            'element' in entry &&
            isElement((entry as { element?: unknown }).element)
          ) {
            const element = (entry as { element: Element }).element
            if (isLikelyAssistantMessage(element)) {
              found.set((entry as { messageId: string }).messageId, element)
            }
          }
        }
      }
    }

    const listMessageIds = messagesApi.listMessageIds
    if (typeof listMessageIds === 'function') {
      const listed = listMessageIds.call(ctx.messages) as unknown
      if (Array.isArray(listed)) {
        for (const messageId of listed) {
          if (typeof messageId === 'string' && !found.has(messageId)) {
            const fallbackElement = document.querySelector(
              `[data-message-id="${messageId}"], [data-messageid="${messageId}"], [data-message="${messageId}"]`,
            )
            if (fallbackElement && isElement(fallbackElement) && isLikelyAssistantMessage(fallbackElement)) {
              found.set(messageId, fallbackElement)
            }
          }
        }
      }
    }

    const actionTargets = document.querySelectorAll(ACTION_ROW_SELECTORS.join(', '))
    for (const target of actionTargets) {
      if (!isElement(target)) continue
      const resolved = resolveMessageIdFromNode(target)
      if (resolved && !found.has(resolved) && isLikelyAssistantMessage(target)) {
        found.set(resolved, target)
      }
    }

    if (found.size === 0) {
      const genericCandidates = document.querySelectorAll(
        '[data-message-id], [data-messageid], [data-message], [data-id], article, [role="article"], .message',
      )
      for (const candidate of genericCandidates) {
        if (!isElement(candidate)) continue
        const resolved = resolveMessageIdFromNode(candidate)
        if (resolved && !found.has(resolved) && isLikelyAssistantMessage(candidate)) {
          found.set(resolved, candidate)
        }
      }
    }

    const getLatestMessageId = messagesApi.getLatestMessageId
    if (typeof getLatestMessageId === 'function') {
      const latest = getLatestMessageId.call(ctx.messages) as unknown
      if (typeof latest === 'string' && latest.length > 0 && !found.has(latest)) {
        const fallbackElement = document.querySelector(
          `[data-message-id="${latest}"], [data-messageid="${latest}"], [data-message="${latest}"]`,
        )
        if (fallbackElement && isElement(fallbackElement) && isLikelyAssistantMessage(fallbackElement)) {
          found.set(latest, fallbackElement)
        }
      }
    }

    return Array.from(found.entries()).map(([messageId, element]) => ({ messageId, element }))
  }

  function findActionRowTarget(bubble: Element): Element {
    for (const selector of ACTION_ROW_SELECTORS) {
      const match = bubble.querySelector(selector)
      if (match) return match
    }

    const classMatches = Array.from(bubble.querySelectorAll('div')).find((element) =>
      typeof element.className === 'string' &&
      (element.className.includes('_actionsWrap_') || element.className.includes('_actions_wrap_')),
    )
    if (classMatches) return classMatches

    const bubbleButtons = Array.from(bubble.querySelectorAll('button'))
    for (const button of bubbleButtons) {
      const parent = button.parentElement
      if (!parent) continue
      if (parent.childElementCount >= 3) {
        return parent
      }
    }

    return bubble
  }

  function ensureControl(messageId: string, sourceElement: Element) {
    const existingWrapper = injections.get(messageId)
    const existingTarget = targets.get(messageId)

    if (existingWrapper && !existingWrapper.isConnected) {
      injections.delete(messageId)
      buttons.delete(messageId)
      menuButtons.delete(messageId)
      statusLabels.delete(messageId)
      breakoutPanels.delete(messageId)
      if (existingTarget === existingWrapper.parentElement || existingTarget?.isConnected === false) {
        targets.delete(messageId)
      }
    }

    if (injections.has(messageId)) {
      if (existingTarget && existingTarget !== findActionRowTarget(sourceElement)) {
        const wrapper = injections.get(messageId)
        if (wrapper?.isConnected) {
          ctx.dom.uninject(wrapper)
        }
        injections.delete(messageId)
        buttons.delete(messageId)
        menuButtons.delete(messageId)
        statusLabels.delete(messageId)
        breakoutPanels.delete(messageId)
        targets.delete(messageId)
      } else {
        updateMessageVisual(messageId)
        return
      }
    }

    if (sourceElement.querySelector(CONTROL_SELECTOR)) {
      updateMessageVisual(messageId)
      return
    }

    const target = findActionRowTarget(sourceElement)

    const wrapper = ctx.dom.inject(
      target,
      `
        <div class="lummate-phase1-control">
          <button type="button" class="lummate-phase1-button" title="Play actions" aria-label="Play actions">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" />
            </svg>
          </button>
          <button type="button" class="lummate-phase1-menu-button" title="More actions" aria-label="More actions">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
              <circle cx="8" cy="8" r="1.2" fill="currentColor" />
              <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
            </svg>
          </button>
          <span class="lummate-phase1-status" aria-hidden="true">Phase 1 ready</span>
          <div class="lummate-phase1-breakout" data-open="false">
            <div class="lummate-phase1-breakout-title">Playback</div>
            <div class="lummate-phase1-breakout-row">
              <button type="button" class="lummate-phase1-mode-button" data-mode="once">Play Once</button>
              <button type="button" class="lummate-phase1-mode-button" data-mode="loop">Loop</button>
              <button type="button" class="lummate-phase1-mode-button" data-mode="hold">Play & Hold</button>
            </div>
            <div class="lummate-phase1-breakout-title">Track</div>
            <div class="lummate-phase1-breakout-row lummate-phase1-breakout-track-row"></div>
            <div class="lummate-phase1-breakout-title">Actions</div>
            <div class="lummate-phase1-breakout-row">
              <button type="button" class="lummate-phase1-breakout-action" data-action="regenerate">Regenerate</button>
            </div>
          </div>
        </div>
      `,
      'beforeend',
    )

    const button = wrapper.querySelector('.lummate-phase1-button') as HTMLButtonElement | null
    const menuButton = wrapper.querySelector('.lummate-phase1-menu-button') as HTMLButtonElement | null
    const status = wrapper.querySelector('.lummate-phase1-status') as HTMLElement | null
    const breakout = wrapper.querySelector('.lummate-phase1-breakout') as HTMLElement | null
    if (!button || !menuButton || !status || !breakout) {
      ctx.dom.uninject(wrapper)
      return
    }

    let suppressNextClick = false
    let longPressTriggered = false

    const sendPlayToggle = () => {
      status.textContent = 'Contacting backend...'
      ctx.sendToBackend({
        type: 'lummate.phase1.play_toggle',
        payload: {
          ...getActiveChatContext(),
          messageId,
          playbackModeOverride: getPlaybackModeForMessage(messageId),
        },
      })
    }

    button.addEventListener('click', () => {
      if (suppressNextClick) {
        suppressNextClick = false
        return
      }
      sendPlayToggle()
    })

    menuButton.addEventListener('click', (event) => {
      event.stopPropagation()
      if (openBreakoutMessageId === messageId) {
        closeBreakout()
      } else {
        openBreakout(messageId)
        updateBreakoutModeButtons(messageId)
      }
    })

    if (supportsHover) {
      wrapper.addEventListener('mouseenter', () => {
        scheduleBreakoutOpen(messageId)
      })

      wrapper.addEventListener('mouseleave', () => {
        scheduleBreakoutClose(messageId)
      })

      breakout.addEventListener('mouseenter', () => {
        if (hoverCloseTimer !== null) {
          window.clearTimeout(hoverCloseTimer)
          hoverCloseTimer = null
        }
        if (openBreakoutMessageId !== messageId) {
          openBreakout(messageId)
          updateBreakoutModeButtons(messageId)
        }
      })

      breakout.addEventListener('mouseleave', () => {
        scheduleBreakoutClose(messageId)
      })
    }

    button.addEventListener('touchstart', () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer)
      }
      longPressTriggered = false
      longPressTimer = window.setTimeout(() => {
        longPressTriggered = true
        suppressNextClick = true
        openBreakout(messageId)
        updateBreakoutModeButtons(messageId)
      }, 450)
    })

    const clearLongPress = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    button.addEventListener('touchend', (event) => {
      clearLongPress()
      if (longPressTriggered) {
        event.preventDefault()
        return
      }

      suppressNextClick = true
      event.preventDefault()
      sendPlayToggle()
    })
    button.addEventListener('touchcancel', clearLongPress)

    breakout.addEventListener('click', (event) => {
      const targetElement = event.target instanceof HTMLElement ? event.target : null
      if (!targetElement) return

      const modeButton = targetElement.closest('.lummate-phase1-mode-button') as HTMLButtonElement | null
      if (modeButton) {
        const mode = modeButton.dataset.mode
        if (mode === 'once' || mode === 'loop' || mode === 'hold') {
          playbackModeOverrides.set(messageId, mode)
          updateBreakoutModeButtons(messageId)
          if (currentPlan?.messageId === messageId) {
            ctx.sendToBackend({
              type: 'lummate.phase3.set_playback_mode',
              payload: { ...getActiveChatContext(), messageId, playbackMode: mode },
            })
          } else {
            syncVisuals()
          }
        }
        return
      }

      const trackButton = targetElement.closest('.lummate-phase1-track-button') as HTMLButtonElement | null
      if (trackButton) {
        const participantKind =
          trackButton.dataset.participantKind === 'character' ? 'character' : 'persona'
        const participantId =
          participantKind === 'persona' ? null : trackButton.dataset.participantId?.trim() || null
        const nextPreferences: ChatTrackingPreferences = {
          trackedParticipantId: participantId,
          trackedParticipantKind: participantKind,
          primaryContactZone:
            draftSettings?.parser.primaryUserContactZone ??
            settingsPayload?.settings.parser.primaryUserContactZone ??
            currentChatPreferences?.primaryContactZone ??
            'genitals',
          customContactZone:
            draftSettings?.parser.customUserContactZone ??
            settingsPayload?.settings.parser.customUserContactZone ??
            currentChatPreferences?.customContactZone ??
            '',
        }
        currentChatPreferences = nextPreferences
        updateBreakoutTrackingButtons(messageId)
        updateDebugIndicator()
        ctx.sendToBackend({
          type: 'lummate.phase3.set_tracking_preferences',
          payload: {
            ...getActiveChatContext(),
            ...nextPreferences,
          },
        })
        return
      }

      const actionButton = targetElement.closest('.lummate-phase1-breakout-action') as HTMLButtonElement | null
      if (actionButton?.dataset.action === 'regenerate') {
        status.textContent = 'Regenerating...'
        ctx.sendToBackend({
          type: 'lummate.phase3.regenerate',
          payload: {
            ...getActiveChatContext(),
            messageId,
            playbackModeOverride: getPlaybackModeForMessage(messageId),
          },
        })
        closeBreakout()
      }
    })

    injections.set(messageId, wrapper)
    buttons.set(messageId, button)
    menuButtons.set(messageId, menuButton)
    statusLabels.set(messageId, status)
    breakoutPanels.set(messageId, breakout)
    targets.set(messageId, target)
    updateMessageVisual(messageId)
    updateBreakoutModeButtons(messageId)
    updateBreakoutTrackingButtons(messageId)
  }

  function scanMessages() {
    const visibleMessages = getVisibleMessageTargets()
    const visibleMessageIds = new Set(visibleMessages.map((message) => message.messageId))

    for (const [messageId, wrapper] of injections.entries()) {
      if (!wrapper.isConnected && !visibleMessageIds.has(messageId)) {
        injections.delete(messageId)
        buttons.delete(messageId)
        menuButtons.delete(messageId)
        statusLabels.delete(messageId)
        breakoutPanels.delete(messageId)
        targets.delete(messageId)
      }
    }

    for (const message of visibleMessages) {
      ensureControl(message.messageId, message.element)
    }

    syncVisuals()
  }

  function applyBootstrap(payload: BootstrapPayload) {
    activeChatId = payload.session.activeChatId
    activeMessageId = payload.session.activeMessageId
    currentPlan = payload.session.runtimePlans.currentPlan
    currentHeldState = payload.session.heldState
    currentSchedulerState = payload.session.scheduler
    parserSessionState = payload.session.parserSession
    currentChatPreferences = payload.chatPreferences
    participantProfiles = payload.participantProfiles
    syncVisuals()
    updateDebugIndicator()
    for (const messageId of breakoutPanels.keys()) {
      updateBreakoutModeButtons(messageId)
      updateBreakoutTrackingButtons(messageId)
    }
  }

  function applySettingsBootstrap(payload: SettingsBootstrapPayload, saved: boolean) {
    settingsPayload = payload
    participantProfiles = payload.participantProfiles
    currentChatPreferences = payload.chatPreferences
    draftSettings = cloneSettings(payload.settings)
    settingsSaveInFlight = false
    settingsStatus = saved ? 'Settings saved' : 'Settings loaded'
    updateDebugIndicator()
    for (const messageId of breakoutPanels.keys()) {
      updateBreakoutTrackingButtons(messageId)
    }
    renderSettingsTab()
  }

  const unsubscribe = ctx.onBackendMessage((payload) => {
    if (!isBackendMessage(payload)) return

    switch (payload.type) {
      case 'lummate.phase1.bootstrap_result':
      case 'lummate.phase1.session_state':
        applyBootstrap(payload.payload)
        break
      case 'lummate.phase1.error':
        for (const status of statusLabels.values()) {
          status.textContent = `Error: ${payload.message}`
        }
        break
      case 'lummate.settings.bootstrap_result':
        applySettingsBootstrap(payload.payload, false)
        break
      case 'lummate.settings.save_result':
        applySettingsBootstrap(payload.payload, true)
        break
      case 'lummate.phase5.profile_result':
        participantProfiles = payload.payload
        settingsStatus = 'Participant profiles refreshed'
        updateDebugIndicator()
        for (const messageId of breakoutPanels.keys()) {
          updateBreakoutTrackingButtons(messageId)
        }
        renderSettingsTab()
        break
    }
  })

  const detachInputAction = inputAction.onClick(() => {
    settingsTab.activate()
  })

  const detachTabActivate = settingsTab.onActivate(() => {
    if (!settingsPayload) {
      settingsStatus = 'Loading settings...'
      renderSettingsTab()
      ctx.sendToBackend({ type: 'lummate.settings.bootstrap', payload: getActiveChatContext() })
    }
  })

  ctx.sendToBackend({ type: 'lummate.phase1.bootstrap', payload: getActiveChatContext() })
  ctx.sendToBackend({ type: 'lummate.settings.bootstrap', payload: getActiveChatContext() })
  scanMessages()
  const scanInterval = window.setInterval(() => {
    syncActiveChat()
    scanMessages()
  }, 1200)

  return () => {
    window.clearInterval(scanInterval)
    unsubscribe()
    detachInputAction()
    detachTabActivate()
    inputAction.destroy()
    settingsTab.destroy()
    clearSettingsComponents()
    clearHoverTimers()
    removeStyle()
    if (DEBUG_OVERLAY_SUPPORTED) {
      debugIndicator.remove()
    }

    for (const wrapper of injections.values()) {
      ctx.dom.uninject(wrapper)
    }

    injections.clear()
    buttons.clear()
    menuButtons.clear()
    statusLabels.clear()
    breakoutPanels.clear()
    targets.clear()
  }
}

const frontendModule: SpindleFrontendModule = {
  setup,
}

export default frontendModule

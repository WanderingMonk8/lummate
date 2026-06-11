import type {
  SpindleFrontendContext,
  SpindleFrontendModule,
  SpindleMountedComponent,
} from 'lumiverse-spindle-types'
import type {
  ActionType,
  BackendToFrontendMessage,
  BootstrapPayload,
  MessagePlan,
  SettingsBootstrapPayload,
  UserSettings,
} from './shared/contracts'

const CALIBRATABLE_ACTION_TYPES: ActionType[] = [
  'tease',
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
  const statusLabels = new Map<string, HTMLElement>()
  const previewLabels = new Map<string, HTMLElement>()
  const targets = new Map<string, Element>()
  const settingsComponents: Array<SpindleMountedComponent<unknown>> = []

  let activeMessageId: string | null = null
  let activeChatId: string | null = ctx.getActiveChat().chatId
  let currentPlan: MessagePlan | null = null
  let settingsPayload: SettingsBootstrapPayload | null = null
  let draftSettings: UserSettings | null = null
  let settingsStatus = 'Loading settings...'
  let settingsSaveInFlight = false

  const removeStyle = ctx.dom.addStyle(`
    .lummate-phase1-control {
      display: flex;
      align-items: center;
      margin-left: 6px;
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
    .lummate-phase1-status {
      display: none;
    }
    .lummate-phase1-preview {
      display: inline-flex;
      align-items: center;
      max-width: 190px;
      margin-left: 8px;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      background: rgba(15, 23, 42, 0.36);
      color: rgba(191, 219, 254, 0.92);
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lummate-phase1-preview[data-visible="false"] {
      display: none;
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

  function updateMessageVisual(messageId: string) {
    const button = buttons.get(messageId)
    const status = statusLabels.get(messageId)
    const preview = previewLabels.get(messageId)
    if (!button || !status || !preview) return

    const isActive = activeMessageId === messageId
    button.dataset.active = isActive ? 'true' : 'false'
    button.title = isActive ? 'Stop actions' : 'Play actions'
    button.setAttribute('aria-label', isActive ? 'Stop actions' : 'Play actions')
    status.textContent = isActive ? 'Phase 1 active' : 'Phase 1 ready'

    const previewText = buildPlanPreview(messageId, currentPlan)
    preview.dataset.visible = previewText ? 'true' : 'false'
    preview.textContent = previewText || ''
  }

  function syncVisuals() {
    for (const messageId of buttons.keys()) {
      updateMessageVisual(messageId)
    }
  }

  function syncActiveChat() {
    const nextChatId = ctx.getActiveChat().chatId
    if (nextChatId === activeChatId) return

    activeChatId = nextChatId
    activeMessageId = null
    currentPlan = null
    syncVisuals()

    ctx.sendToBackend({
      type: 'lummate.phase1.chat_changed',
      payload: { chatId: activeChatId },
    })
  }

  function cloneSettings(settings: UserSettings): UserSettings {
    return {
      parser: { ...settings.parser },
      xtoysActionMappings: settings.xtoysActionMappings.map((mapping) => ({ ...mapping })),
      actionCalibrationPresets: settings.actionCalibrationPresets.map((preset) => ({ ...preset })),
    }
  }

  function buildPlanPreview(messageId: string, plan: MessagePlan | null): string | null {
    if (!plan || plan.messageId !== messageId) return null

    const beat = plan.resolvedBeats[0]
    if (!beat) return null

    return `${beat.actionType} ${Math.round(beat.amplitude)}/${Math.round(beat.tempo)} ${plan.playbackMode}`
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
      },
    })
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

    root.appendChild(parserSection)

    const mappingsSection = document.createElement('section')
    mappingsSection.className = 'lummate-settings-section'
    mappingsSection.innerHTML = `
      <h3>XToys Action Mapping</h3>
      <p>Each semantic action type maps to an XToys action name defined inside your own XToys webhook script.</p>
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
    if (injections.has(messageId)) {
      updateMessageVisual(messageId)
      return
    }

    if (sourceElement.querySelector(CONTROL_SELECTOR)) return

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
          <span class="lummate-phase1-status" aria-hidden="true">Phase 1 ready</span>
          <span class="lummate-phase1-preview" data-visible="false" aria-hidden="true"></span>
        </div>
      `,
      'beforeend',
    )

    const button = wrapper.querySelector('.lummate-phase1-button') as HTMLButtonElement | null
    const status = wrapper.querySelector('.lummate-phase1-status') as HTMLElement | null
    const preview = wrapper.querySelector('.lummate-phase1-preview') as HTMLElement | null
    if (!button || !status || !preview) {
      ctx.dom.uninject(wrapper)
      return
    }

    button.addEventListener('click', () => {
      status.textContent = 'Contacting backend...'
      ctx.sendToBackend({
        type: 'lummate.phase1.play_toggle',
        payload: { chatId: activeChatId, messageId },
      })
    })

    injections.set(messageId, wrapper)
    buttons.set(messageId, button)
    statusLabels.set(messageId, status)
    previewLabels.set(messageId, preview)
    targets.set(messageId, target)
    updateMessageVisual(messageId)
  }

  function scanMessages() {
    const visibleMessages = getVisibleMessageTargets()

    for (const message of visibleMessages) {
      ensureControl(message.messageId, message.element)
    }
  }

  function applyBootstrap(payload: BootstrapPayload) {
    activeChatId = payload.session.activeChatId
    activeMessageId = payload.session.activeMessageId
    currentPlan = payload.session.runtimePlans.currentPlan
    syncVisuals()
  }

  function applySettingsBootstrap(payload: SettingsBootstrapPayload, saved: boolean) {
    settingsPayload = payload
    draftSettings = cloneSettings(payload.settings)
    settingsSaveInFlight = false
    settingsStatus = saved ? 'Settings saved' : 'Settings loaded'
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
    }
  })

  const detachInputAction = inputAction.onClick(() => {
    settingsTab.activate()
  })

  const detachTabActivate = settingsTab.onActivate(() => {
    if (!settingsPayload) {
      settingsStatus = 'Loading settings...'
      renderSettingsTab()
      ctx.sendToBackend({ type: 'lummate.settings.bootstrap' })
    }
  })

  ctx.sendToBackend({ type: 'lummate.phase1.bootstrap', payload: { chatId: activeChatId } })
  ctx.sendToBackend({ type: 'lummate.settings.bootstrap' })
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
    removeStyle()

    for (const wrapper of injections.values()) {
      ctx.dom.uninject(wrapper)
    }

    injections.clear()
    buttons.clear()
    statusLabels.clear()
    previewLabels.clear()
    targets.clear()
  }
}

const frontendModule: SpindleFrontendModule = {
  setup,
}

export default frontendModule

import type { SpindleFrontendContext, SpindleFrontendModule } from 'lumiverse-spindle-types'
import type { BackendToFrontendMessage, BootstrapPayload } from './shared/contracts'

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

export function setup(ctx: SpindleFrontendContext) {
  const injections = new Map<string, Element>()
  const buttons = new Map<string, HTMLButtonElement>()
  const statusLabels = new Map<string, HTMLElement>()
  const targets = new Map<string, Element>()

  let activeMessageId: string | null = null

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
  `)

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
            found.set(
              (entry as { messageId: string }).messageId,
              (entry as { element: Element }).element,
            )
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
            if (fallbackElement && isElement(fallbackElement)) {
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
      if (resolved && !found.has(resolved)) {
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
        if (resolved && !found.has(resolved)) {
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
        if (fallbackElement && isElement(fallbackElement)) {
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
        </div>
      `,
      'beforeend',
    )

    const button = wrapper.querySelector('.lummate-phase1-button') as HTMLButtonElement | null
    const status = wrapper.querySelector('.lummate-phase1-status') as HTMLElement | null
    if (!button || !status) {
      ctx.dom.uninject(wrapper)
      return
    }

    button.addEventListener('click', () => {
      status.textContent = 'Contacting backend...'
      ctx.sendToBackend({
        type: 'lummate.phase1.play_toggle',
        payload: { messageId },
      })
    })

    injections.set(messageId, wrapper)
    buttons.set(messageId, button)
    statusLabels.set(messageId, status)
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
    activeMessageId = payload.session.activeMessageId
    syncVisuals()
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
    }
  })

  ctx.sendToBackend({ type: 'lummate.phase1.bootstrap' })
  scanMessages()
  const scanInterval = window.setInterval(scanMessages, 1200)

  return () => {
    window.clearInterval(scanInterval)
    unsubscribe()
    removeStyle()

    for (const wrapper of injections.values()) {
      ctx.dom.uninject(wrapper)
    }

    injections.clear()
    buttons.clear()
    statusLabels.clear()
    targets.clear()
  }
}

const frontendModule: SpindleFrontendModule = {
  setup,
}

export default frontendModule

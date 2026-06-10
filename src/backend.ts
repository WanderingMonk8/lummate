declare const spindle: import('lumiverse-spindle-types').SpindleAPI

import type {
  BackendToFrontendMessage,
  FrontendToBackendMessage,
} from './shared/contracts'
import { readSessionState, readUserSettings, writeSessionState } from './backend/storage'

function sendToUser(message: BackendToFrontendMessage, userId: string) {
  spindle.sendToFrontend(message, userId)
}

function isFrontendMessage(payload: unknown): payload is FrontendToBackendMessage {
  return typeof payload === 'object' && payload !== null && 'type' in payload
}

async function buildBootstrap(userId: string) {
  const [settings, session] = await Promise.all([
    readUserSettings(spindle, userId),
    readSessionState(spindle, userId),
  ])

  return { settings, session }
}

async function handleFrontendMessage(
  payload: FrontendToBackendMessage,
  userId: string,
): Promise<void> {
  try {
    switch (payload.type) {
      case 'lummate.phase1.bootstrap': {
        const bootstrap = await buildBootstrap(userId)
        sendToUser(
          {
            type: 'lummate.phase1.bootstrap_result',
            payload: bootstrap,
          },
          userId,
        )
        return
      }
      case 'lummate.phase1.play_toggle': {
        const current = await readSessionState(spindle, userId)
        const nextActiveMessageId =
          current.activeMessageId === payload.payload.messageId
            ? null
            : payload.payload.messageId

        const nextSession = {
          ...current,
          activeMessageId: nextActiveMessageId,
          lastPlayedMessageId: payload.payload.messageId,
          lastUpdatedAt: new Date().toISOString(),
        }

        await writeSessionState(spindle, userId, nextSession)

        const bootstrap = await buildBootstrap(userId)
        sendToUser(
          {
            type: 'lummate.phase1.session_state',
            payload: bootstrap,
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

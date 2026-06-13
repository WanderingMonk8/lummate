import type { CharacterDTO, ChatDTO, PersonaDTO, SpindleAPI } from 'lumiverse-spindle-types'
import {
  DEFAULT_MECHANICAL_AXES,
  type MechanicalAxes,
  type ParticipantKind,
  type ParticipantProfile,
  type ParticipantProfileBundle,
} from '../shared/contracts'
import { readParticipantProfileStore, writeParticipantProfileStore } from './storage'

interface ParticipantSourceSnapshot {
  participantKind: ParticipantKind
  participantId: string
  displayName: string
  aliasHints: string[]
  sourceCardId: string | null
  sourceCardName: string | null
  sourceUpdatedAt: number | null
  sourcePreview: string
  combinedText: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function buildFingerprint(source: ParticipantSourceSnapshot): string {
  const payload = [
    source.participantKind,
    source.participantId,
    source.displayName,
    source.aliasHints.join('|'),
    source.sourceCardId ?? '',
    source.sourceCardName ?? '',
    source.sourceUpdatedAt ?? '',
    normalizeText(source.combinedText),
  ].join('||')

  let hash = 2166136261
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

function scoreKeywords(text: string, weights: Array<[RegExp, number]>): number {
  let score = 0
  for (const [pattern, weight] of weights) {
    if (pattern.test(text)) {
      score += weight
    }
  }
  return score
}

function deriveMechanicalAxes(combinedText: string): MechanicalAxes {
  const normalized = normalizeText(combinedText)

  const baselineStrengthBias = scoreKeywords(normalized, [
    [/\b(strong|powerful|muscular|athletic|rough|forceful|heavy)\b/g, 18],
    [/\b(weak|frail|delicate|gentle|soft|meek|shy)\b/g, -16],
  ])

  const baselineTempoBias = scoreKeywords(normalized, [
    [/\b(fast|quick|frantic|restless|eager|urgent|hungry)\b/g, 16],
    [/\b(slow|patient|steady|careful|hesitant|languid)\b/g, -12],
  ])

  const rampAggression = scoreKeywords(normalized, [
    [/\b(feral|primal|aggressive|dominant|bold|rough|demanding)\b/g, 20],
    [/\b(gentle|shy|timid|hesitant|careful|restrained)\b/g, -18],
  ])

  const motionWeight = scoreKeywords(normalized, [
    [/\b(heavy|grounded|solid|strong|deep)\b/g, 16],
    [/\b(light|nimble|thin|slender|delicate)\b/g, -10],
  ])

  const endurance = scoreKeywords(normalized, [
    [/\b(enduring|well[- ]?rested|rested|relentless|athletic|stamina)\b/g, 18],
    [/\b(tired|exhausted|drained|sedated|weak|shaky)\b/g, -20],
  ])

  const smoothness = scoreKeywords(normalized, [
    [/\b(smooth|sensual|steady|gentle|teasing|patient)\b/g, 16],
    [/\b(jerky|rough|frantic|desperate|chaotic)\b/g, -14],
  ])

  const dominancePressure = scoreKeywords(normalized, [
    [/\b(dominant|commanding|possessive|insistent|assertive|bold)\b/g, 20],
    [/\b(submissive|meek|shy|yielding|hesitant)\b/g, -18],
  ])

  const teasingTendency = scoreKeywords(normalized, [
    [/\b(teasing|playful|patient|tormenting|sensual|lingering)\b/g, 18],
    [/\b(direct|blunt|urgent|desperate|immediate)\b/g, -12],
  ])

  return {
    baselineStrengthBias: clamp(baselineStrengthBias, -100, 100),
    baselineTempoBias: clamp(baselineTempoBias, -100, 100),
    rampAggression: clamp(rampAggression, -100, 100),
    motionWeight: clamp(motionWeight, -100, 100),
    endurance: clamp(endurance, -100, 100),
    smoothness: clamp(smoothness, -100, 100),
    dominancePressure: clamp(dominancePressure, -100, 100),
    teasingTendency: clamp(teasingTendency, -100, 100),
  }
}

function createProfileFromSource(source: ParticipantSourceSnapshot): ParticipantProfile {
  return {
    participantKind: source.participantKind,
    participantId: source.participantId,
    displayName: source.displayName,
    aliasHints: source.aliasHints,
    sourceCardId: source.sourceCardId,
    sourceCardName: source.sourceCardName,
    sourceFingerprint: buildFingerprint(source),
    sourceUpdatedAt: source.sourceUpdatedAt,
    sourcePreview: source.sourcePreview,
    mechanicalAxes: deriveMechanicalAxes(source.combinedText),
    userOverrides: { ...DEFAULT_MECHANICAL_AXES },
    updatedAt: new Date().toISOString(),
  }
}

function buildCharacterSource(character: CharacterDTO): ParticipantSourceSnapshot {
  const combinedText = [
    character.description,
    character.personality,
    character.scenario,
    character.first_mes,
    character.creator_notes,
    character.system_prompt,
    character.post_history_instructions,
    character.tags.join(' '),
  ]
    .filter(Boolean)
    .join('\n')

  const sourcePreview = [character.personality, character.description, character.scenario]
    .filter(Boolean)
    .join(' ')
    .slice(0, 240)

  return {
    participantKind: 'character',
    participantId: character.id,
    displayName: character.name,
    aliasHints: [character.name],
    sourceCardId: character.id,
    sourceCardName: character.name,
    sourceUpdatedAt: character.updated_at ?? null,
    sourcePreview,
    combinedText,
  }
}

function buildPersonaSource(persona: PersonaDTO): ParticipantSourceSnapshot {
  const metadataText =
    persona.metadata && Object.keys(persona.metadata).length > 0 ? JSON.stringify(persona.metadata) : ''

  const combinedText = [persona.name, persona.title, persona.description, metadataText]
    .filter(Boolean)
    .join('\n')

  const sourcePreview = [persona.title, persona.description].filter(Boolean).join(' ').slice(0, 240)

  return {
    participantKind: 'persona',
    participantId: persona.id,
    displayName: persona.name,
    aliasHints: [persona.name],
    sourceCardId: persona.id,
    sourceCardName: persona.name,
    sourceUpdatedAt: persona.updated_at ?? null,
    sourcePreview,
    combinedText,
  }
}

function slugifyParticipantName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function splitCompositeCharacterNames(name: string): string[] {
  return name
    .split(/\s*(?:&|\/|,|\band\b|\+)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
}

function buildParticipantAliasHints(displayName: string): string[] {
  const tokens = displayName
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)

  return [...new Set([displayName, ...tokens])]
}

function extractParticipantFocusedText(combinedText: string, aliasHints: string[]): string {
  const sentences = combinedText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  const matchingSentences = sentences.filter((sentence) =>
    aliasHints.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sentence)),
  )

  if (matchingSentences.length === 0) {
    return combinedText
  }

  return matchingSentences.join('\n')
}

function buildCharacterSources(character: CharacterDTO): ParticipantSourceSnapshot[] {
  const baseSource = buildCharacterSource(character)
  const participantNames = splitCompositeCharacterNames(character.name)

  if (participantNames.length <= 1) {
    return [baseSource]
  }

  return participantNames.map((participantName) => {
    const aliasHints = buildParticipantAliasHints(participantName)
    return {
      participantKind: 'character' as const,
      participantId: `${character.id}::${slugifyParticipantName(participantName)}`,
      displayName: participantName,
      aliasHints,
      sourceCardId: character.id,
      sourceCardName: character.name,
      sourceUpdatedAt: character.updated_at ?? null,
      sourcePreview: baseSource.sourcePreview,
      combinedText: extractParticipantFocusedText(baseSource.combinedText, aliasHints),
    }
  })
}

function buildProfileKey(participantKind: ParticipantKind, participantId: string): string {
  return `${participantKind}:${participantId}`
}

async function resolveUserPersona(spindle: SpindleAPI, userId: string): Promise<PersonaDTO | null> {
  const active = await spindle.personas.getActive(userId)
  if (active) return active
  return spindle.personas.getDefault(userId)
}

function collectCharacterIdsFromUnknown(value: unknown, sink: Set<string>) {
  if (!value) return

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) sink.add(trimmed)
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectCharacterIdsFromUnknown(entry, sink)
    }
    return
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const directId =
      typeof record.characterId === 'string'
        ? record.characterId
        : typeof record.character_id === 'string'
          ? record.character_id
          : typeof record.id === 'string'
            ? record.id
            : null

    if (directId?.trim()) {
      sink.add(directId.trim())
    }
  }
}

function extractChatCharacterIds(chat: ChatDTO | null, primaryCharacterId: string | null): string[] {
  const ids = new Set<string>()

  if (primaryCharacterId?.trim()) {
    ids.add(primaryCharacterId.trim())
  }

  if (chat?.character_id?.trim()) {
    ids.add(chat.character_id.trim())
  }

  if (!chat?.metadata || typeof chat.metadata !== 'object') {
    return Array.from(ids)
  }

  const metadata = chat.metadata as Record<string, unknown>
  const candidateKeys = [
    'characterIds',
    'character_ids',
    'characters',
    'members',
    'participants',
    'groupMembers',
    'group_members',
  ]

  for (const key of candidateKeys) {
    collectCharacterIdsFromUnknown(metadata[key], ids)
  }

  return Array.from(ids)
}

async function ensureProfileFromSource(
  spindle: SpindleAPI,
  userId: string,
  source: ParticipantSourceSnapshot | null,
  forceRegenerate: boolean,
): Promise<ParticipantProfile | null> {
  if (!source) return null

  const store = await readParticipantProfileStore(spindle, userId)
  const key = buildProfileKey(source.participantKind, source.participantId)
  const existing = store.profiles[key] ?? null
  const nextFingerprint = buildFingerprint(source)

  if (
    !forceRegenerate &&
    existing &&
    existing.sourceFingerprint === nextFingerprint &&
    existing.sourceUpdatedAt === source.sourceUpdatedAt
  ) {
    return existing
  }

  const derived = createProfileFromSource(source)
  store.profiles[key] = existing
    ? {
        ...derived,
        userOverrides: existing.userOverrides,
      }
    : derived

  await writeParticipantProfileStore(spindle, userId, store)
  return store.profiles[key]
}

export async function ensureParticipantProfileBundle(
  spindle: SpindleAPI,
  userId: string,
  options: {
    chatId?: string | null
    characterId?: string | null
    forceUserRegenerate?: boolean
    forceCharacterRegenerate?: boolean
  },
): Promise<ParticipantProfileBundle> {
  const [persona, chat] = await Promise.all([
    resolveUserPersona(spindle, userId),
    options.chatId ? spindle.chats.get(options.chatId, userId) : Promise.resolve(null),
  ])

  const characterIds = extractChatCharacterIds(chat, options.characterId ?? null)
  const characters = await Promise.all(
    characterIds.map((characterId) => spindle.characters.get(characterId, userId)),
  )

  const userSource = persona ? buildPersonaSource(persona) : null
  const characterSources = characters
    .filter((character): character is CharacterDTO => Boolean(character))
    .flatMap(buildCharacterSources)

  const [userProfile, ...resolvedCharacterProfiles] = await Promise.all([
    ensureProfileFromSource(spindle, userId, userSource, options.forceUserRegenerate ?? false),
    ...characterSources.map((characterSource) =>
      ensureProfileFromSource(
        spindle,
        userId,
        characterSource,
        options.forceCharacterRegenerate ?? false,
      ),
    ),
  ])

  return {
    userProfile,
    characterProfiles: resolvedCharacterProfiles.filter(
      (profile): profile is ParticipantProfile => Boolean(profile),
    ),
  }
}

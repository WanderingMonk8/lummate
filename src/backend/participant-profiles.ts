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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitCompositeCharacterNames(name: string): string[] {
  return name
    .split(/\s*(?:&|\/|,|\band\b|\+)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
}

type CompositeParticipantEvidence = {
  explicitList: boolean
  metadata: boolean
  structuredSection: boolean
}

type TaggedParticipantSection = {
  sectionName: string
  displayName: string
  content: string
}

function normalizeNameToken(value: string): string {
  return value.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, '').toLowerCase()
}

function buildSectionReferenceHints(name: string): string[] {
  const tokens = name
    .split(/\s+/)
    .map((token) => token.trim().replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, ''))
    .filter((token) => token.length >= 3)

  return [...new Set([name.trim(), ...tokens])]
}

function tokenizeName(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => normalizeNameToken(token))
    .filter((token) => token.length >= 2)
}

function hasSupportingNameReference(name: string, content: string): boolean {
  const hints = buildSectionReferenceHints(name)
  if (hints.length === 0) return false

  return hints.some((hint) => {
    const pattern = new RegExp(`\\b${escapeRegExp(hint)}\\b`, 'i')
    return pattern.test(content)
  })
}

function resolveCanonicalParticipantName(
  name: string,
  candidateNames: string[],
): string {
  const trimmed = name.trim()
  const tokens = tokenizeName(trimmed)
  if (tokens.length !== 1) return trimmed

  const token = tokens[0]
  const candidates = candidateNames.filter((candidate) => {
    const candidateTokens = tokenizeName(candidate)
    return candidateTokens.length > 1 && candidateTokens.includes(token)
  })

  if (candidates.length === 0) return trimmed

  candidates.sort((left, right) => right.length - left.length)
  return candidates[0]
}

function dedupeParticipantNames(names: string[]): string[] {
  if (names.length <= 1) return names

  const uniqueNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  const canonicalNames = uniqueNames.map((name) =>
    resolveCanonicalParticipantName(name, uniqueNames),
  )

  return [...new Set(canonicalNames)]
}

function dedupeStructuredParticipantSections(
  sections: TaggedParticipantSection[],
): TaggedParticipantSection[] {
  if (sections.length <= 1) return sections

  const allNames = sections.map((section) => section.displayName)
  const merged = new Map<string, TaggedParticipantSection>()

  for (const section of sections) {
    const canonicalName = resolveCanonicalParticipantName(section.displayName, allNames)
    const existing = merged.get(canonicalName)
    if (!existing) {
      merged.set(canonicalName, {
        sectionName: section.sectionName,
        displayName: canonicalName,
        content: section.content,
      })
      continue
    }

    const combinedContent = [existing.content, section.content].filter(Boolean).join('\n\n').trim()
    merged.set(canonicalName, {
      sectionName: existing.sectionName.length >= section.sectionName.length ? existing.sectionName : section.sectionName,
      displayName: canonicalName,
      content: combinedContent,
    })
  }

  return Array.from(merged.values())
}

function isLikelyParticipantName(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 2 || trimmed.length > 48) return false
  if (!/[A-Za-z]/.test(trimmed)) return false
  if (/^(participants?|characters?|members?|cast|group|pair|duo|trio)$/i.test(trimmed)) return false
  if (/\b(and|with|between|from|into|onto|while|where|when|because|through)\b/i.test(trimmed)) return false

  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length > 4) return false

  return tokens.every((token) => /^[A-Z][A-Za-z'’-]*$/.test(token))
}

function markParticipantEvidence(
  sink: Map<string, CompositeParticipantEvidence>,
  rawName: string,
  flags: Partial<CompositeParticipantEvidence>,
) {
  const name = rawName.trim()
  if (!isLikelyParticipantName(name)) return

  const existing = sink.get(name) ?? {
    explicitList: false,
    metadata: false,
    structuredSection: false,
  }

  sink.set(name, {
    explicitList: existing.explicitList || flags.explicitList === true,
    metadata: existing.metadata || flags.metadata === true,
    structuredSection: existing.structuredSection || flags.structuredSection === true,
  })
}

function collectParticipantNamesFromUnknown(
  value: unknown,
  sink: Map<string, CompositeParticipantEvidence>,
  flags: Partial<CompositeParticipantEvidence>,
) {
  if (!value) return

  if (typeof value === 'string') {
    for (const part of splitCompositeCharacterNames(value)) {
      markParticipantEvidence(sink, part, flags)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectParticipantNamesFromUnknown(entry, sink, flags)
    }
    return
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['name', 'displayName', 'label', 'title']) {
      if (typeof record[key] === 'string') {
        collectParticipantNamesFromUnknown(record[key], sink, flags)
      }
    }
  }
}

function countCompositeParticipantSupport(
  name: string,
  combinedText: string,
): {
  sentenceMentions: number
  lineMentions: number
  anchoredMentions: number
  focusedChars: number
} {
  const aliases = buildParticipantAliasHints(name)
  const patterns = aliases.map((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i'))

  const sentences = combinedText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  const lines = combinedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const matchingSentences = sentences.filter((sentence) => patterns.some((pattern) => pattern.test(sentence)))
  const matchingLines = lines.filter((line) => patterns.some((pattern) => pattern.test(line)))
  const anchoredMentions = lines.filter((line) =>
    aliases.some((alias) => {
      const escaped = escapeRegExp(alias)
      return new RegExp(`^(?:[-*]\\s*)?${escaped}(?:\\s*[:\\-]|\\s*\\|)`, 'i').test(line)
    }),
  )

  return {
    sentenceMentions: matchingSentences.length,
    lineMentions: matchingLines.length,
    anchoredMentions: anchoredMentions.length,
    focusedChars: matchingSentences.reduce((sum, sentence) => sum + sentence.length, 0),
  }
}

const NON_PARTICIPANT_SECTION_HEADERS = new Set([
  'appearance',
  'personality',
  'at a glance',
  'likes',
  'dislikes',
  'quirks & habits',
  'quirks and habits',
  'fetishes',
  'background',
  'backstory',
  'behaviour',
  'behavior',
  'intimacy',
  'relationship with {{user}}',
  'relationship',
  'typical attire',
  'clothes',
  'scent',
  'occupation',
  'main plot',
  'plot momentum',
  'physics',
  'scene pacing',
  'next path options',
  'selected path',
  'strategy reason',
])

const ABSTRACT_PARTICIPANT_HEADING_TOKENS = new Set([
  'agenda',
  'affection',
  'analysis',
  'appetite',
  'attraction',
  'bond',
  'chemistry',
  'clinical',
  'conflict',
  'connection',
  'desire',
  'devotion',
  'dynamic',
  'dynamics',
  'emotion',
  'emotions',
  'fantasy',
  'fate',
  'focus',
  'goal',
  'goals',
  'growth',
  'history',
  'hunger',
  'identity',
  'impulse',
  'instinct',
  'instincts',
  'intention',
  'intentions',
  'journey',
  'kink',
  'kinks',
  'love',
  'memory',
  'memories',
  'motivation',
  'motivations',
  'need',
  'needs',
  'obsession',
  'pattern',
  'patterns',
  'profile',
  'profiles',
  'promise',
  'promises',
  'relationship',
  'relationships',
  'role',
  'roles',
  'scene',
  'secret',
  'secrets',
  'sentiment',
  'shadow',
  'state',
  'states',
  'story',
  'summary',
  'temperament',
  'theme',
  'themes',
  'trait',
  'traits',
  'trauma',
  'truth',
  'urge',
  'urges',
  'vow',
  'vows',
  'wound',
  'wounds',
])

function isLikelyAbstractParticipantHeading(value: string): boolean {
  const tokens = value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z]+|[^a-z]+$/g, ''))
    .filter(Boolean)

  if (tokens.length === 0) return false
  return tokens.every((token) => ABSTRACT_PARTICIPANT_HEADING_TOKENS.has(token))
}

function resolveCanonicalSectionName(
  sectionName: string,
  knownNames: Set<string>,
): string {
  const trimmed = sectionName.trim()
  const tokens = tokenizeName(trimmed)
  if (tokens.length !== 1) return trimmed

  const token = tokens[0]
  const candidates = Array.from(knownNames).filter((name) => {
    const candidateTokens = tokenizeName(name)
    return candidateTokens.length > 1 && candidateTokens.includes(token)
  })

  if (candidates.length === 0) return trimmed

  candidates.sort((left, right) => right.length - left.length)
  return candidates[0]
}

function normalizeStandaloneParticipantHeading(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (/^<\/[^>]+>$/.test(trimmed)) return null

  const taggedMatch = trimmed.match(/^<([A-Z][A-Za-z'’-]{1,47})>$/)
  if (taggedMatch?.[1] && isLikelyParticipantName(taggedMatch[1])) {
    return taggedMatch[1]
  }

  const normalized = trimmed
    .replace(/^#+\s*/, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/^__([^_]+)__$/, '$1')
    .trim()

  if (!normalized) return null
  if (NON_PARTICIPANT_SECTION_HEADERS.has(normalized.toLowerCase())) return null
  if (isLikelyAbstractParticipantHeading(normalized)) return null
  if (/[.!?;:]$/.test(normalized)) return null
  if (!isLikelyParticipantName(normalized)) return null

  return normalized
}

function extractStructuredParticipantSections(combinedText: string): TaggedParticipantSection[] {
  const lines = combinedText.split(/\r?\n/)
  const sections: TaggedParticipantSection[] = []
  const knownNames = new Set<string>()
  let currentHeading = ''
  let currentLines: string[] = []

  const flush = () => {
    const sectionName = currentHeading.trim()
    const content = currentLines.join('\n').trim()
    currentHeading = ''
    currentLines = []

    if (!sectionName || !content) return

    const meaningfulLineCount = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length

    if (content.length < 120 && meaningfulLineCount < 4) {
      return
    }

    const fullNameMatch = content.match(/^\s*Full\s+Name\s*:\s*(.+)$/im)
    const canonicalSectionName = resolveCanonicalSectionName(sectionName, knownNames)
    const rawDisplayName = fullNameMatch?.[1]?.trim() || canonicalSectionName
    const displayName = rawDisplayName
      .split(/\s*[,.|/]\s*/)[0]
      .trim()

    if (!isLikelyParticipantName(displayName)) {
      return
    }

    if (!hasSupportingNameReference(displayName, content)) {
      return
    }

    sections.push({
      sectionName,
      displayName,
      content,
    })
    knownNames.add(displayName)
  }

  for (const line of lines) {
    const heading = normalizeStandaloneParticipantHeading(line)
    if (heading) {
      flush()
      currentHeading = heading
      continue
    }

    if (currentHeading && !/^<\/[^>]+>$/.test(line.trim())) {
      currentLines.push(line)
    }
  }

  flush()
  return sections
}

function extractCompositeParticipantNames(character: CharacterDTO, combinedText: string): string[] {
  const names = new Map<string, CompositeParticipantEvidence>()
  for (const part of splitCompositeCharacterNames(character.name)) {
    markParticipantEvidence(names, part, { explicitList: true })
  }

  for (const section of extractStructuredParticipantSections(combinedText)) {
    markParticipantEvidence(names, section.displayName, {
      explicitList: true,
      structuredSection: true,
    })
  }

  const candidateLines = combinedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of candidateLines) {
    const match = line.match(
      /^(participants?|characters?|members?|cast|group members?|pair|duo|trio)\s*:\s*(.+)$/i,
    )
    if (!match?.[2]) continue

    for (const part of splitCompositeCharacterNames(match[2])) {
      markParticipantEvidence(names, part, { explicitList: true, structuredSection: true })
    }
  }

  const metadata = (character as unknown as { metadata?: unknown }).metadata
  if (metadata && typeof metadata === 'object') {
    const record = metadata as Record<string, unknown>
    for (const key of [
      'participants',
      'participantNames',
      'participant_names',
      'characters',
      'members',
      'cast',
      'groupMembers',
      'group_members',
    ]) {
      collectParticipantNamesFromUnknown(record[key], names, {
        explicitList: true,
        metadata: true,
      })
    }
  }

  const participantNames = Array.from(names.entries())
    .filter(([name, evidence]) => {
      const support = countCompositeParticipantSupport(name, combinedText)
      const strongStructuredEvidence =
        evidence.explicitList && (evidence.structuredSection || evidence.metadata)
      const dedicatedCoverage =
        support.anchoredMentions >= 1 ||
        support.sentenceMentions >= 2 ||
        support.lineMentions >= 2 ||
        support.focusedChars >= 180

      return strongStructuredEvidence || dedicatedCoverage
    })
    .map(([name]) => name)

  return dedupeParticipantNames(participantNames)
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
  const taggedSections = dedupeStructuredParticipantSections(
    extractStructuredParticipantSections(baseSource.combinedText),
  )

  if (taggedSections.length > 1) {
    return taggedSections.map((section) => {
      const aliasHints = buildParticipantAliasHints(section.displayName)
      return {
        participantKind: 'character' as const,
        participantId: `${character.id}::${slugifyParticipantName(section.displayName)}`,
        displayName: section.displayName,
        aliasHints,
        sourceCardId: character.id,
        sourceCardName: character.name,
        sourceUpdatedAt: character.updated_at ?? null,
        sourcePreview: baseSource.sourcePreview,
        combinedText: section.content,
      }
    })
  }

  const participantNames = extractCompositeParticipantNames(character, baseSource.combinedText)

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

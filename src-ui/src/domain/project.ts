import type { SampleInfo } from '@/card'
import {
  type AudioRef,
  audioSourceName,
  cardAudio,
  diskAudio,
  type Pad,
  PAD_COUNT,
  type PadId,
  padIdForSlot,
  type PadSettings,
} from '@/domain/pad'
import { clearIntent, keepIntent, type PadIntent, sampleIntent } from '@/domain/plan'
import {
  type Project,
  PROJECT_VERSION,
  type ProjectAudioRef,
  type ProjectEdit,
  type ProjectSlot,
} from '@/projects'

export interface MissingSource {
  audio: ProjectAudioRef
  settings: PadSettings
}

export interface MissingSourceLabel {
  name: string
  location: string
}

export interface ResolutionSummary {
  resolved: number
  moved: number
  fromDisk: number
  missing: number
  keeping: number
  cleared: number
}

export interface Divergence {
  onCard: number
  fromDisk: number
  missing: number
  extra: number
}

export interface RestoreChoice {
  restore: boolean
  clearExtras: boolean
}

export const KEEP_THE_CARD: RestoreChoice = { restore: false, clearExtras: false }

export interface ProjectResolution {
  pads: Record<PadId, Pad>
  intents: Record<PadId, PadIntent>
  orphans: Record<PadId, MissingSource>
  moved: PadId[]
  fromSource: PadId[]
  divergence: Divergence
  summary: ResolutionSummary
}

export interface Portability {
  fromDisk: number
  fromCard: number
}

function isPortable(audio: ProjectAudioRef): boolean {
  return audio.kind === 'path' || Boolean(audio.sourcePath)
}

export function portabilityOf(project: Project): Portability {
  const refs = project.slots.map((slot) => slot.audio).filter((audio) => audio !== null)
  return {
    fromDisk: refs.filter(isPortable).length,
    fromCard: refs.filter((audio) => !isPortable(audio)).length,
  }
}

export function divergedPads(divergence: Divergence): number {
  return divergence.onCard + divergence.fromDisk + divergence.missing + divergence.extra
}

export function diskPathsOf(project: Project): string[] {
  return project.slots.flatMap(({ intent, audio }) => {
    if (audio?.kind === 'path') {
      return intent === 'sample' ? [audio.path] : []
    }
    return audio?.sourcePath ? [audio.sourcePath] : []
  })
}

export function missingSourceLabel(source: MissingSource): MissingSourceLabel {
  const { audio } = source
  if (audio.kind === 'path') {
    return { name: audioSourceName(audio), location: `It was at ${audio.path}` }
  }
  const onCard = `It was on the card, on pad ${padIdForSlot(audio.originSlot)}`
  return {
    name: audio.fileName,
    location: audio.sourcePath ? `${onCard}, and at ${audio.sourcePath}` : onCard,
  }
}

export function editOf(settings: PadSettings): ProjectEdit {
  const { startFrame, endFrame, ...rest } = settings
  return { settings: rest, startFrame, endFrame }
}

export function settingsOf(edit: ProjectEdit): PadSettings {
  return { ...edit.settings, startFrame: edit.startFrame, endFrame: edit.endFrame }
}

function refOf(audio: AudioRef | null, sample: SampleInfo | null): ProjectAudioRef | null {
  if (!audio) {
    return null
  }
  if (audio.kind === 'path') {
    return { kind: 'path', path: audio.path }
  }
  const ref: ProjectAudioRef = {
    kind: 'card',
    originSlot: audio.originSlot,
    fileName: audio.fileName,
    fingerprint: sample?.fingerprint ?? '',
  }
  return audio.sourcePath ? { ...ref, sourcePath: audio.sourcePath } : ref
}

export function projectDocument(
  name: string,
  cardRoot: string | null,
  pads: Pad[],
  intents: Record<PadId, PadIntent>,
): Project {
  const slots: ProjectSlot[] = pads.map((pad) => ({
    slot: pad.slot,
    intent: (intents[pad.id] ?? keepIntent()).kind,
    audio: refOf(pad.audio, pad.sample),
    edit: editOf(pad.settings),
  }))

  return { version: PROJECT_VERSION, name, savedAt: 0, cardRoot, slots }
}

interface CardSample {
  slot: number
  sample: SampleInfo
}

type Located =
  { kind: 'card'; found: CardSample } | { kind: 'disk'; path: string; fromSource: boolean }

function samplesByFingerprint(cardPads: Record<PadId, Pad>): Map<string, CardSample[]> {
  const index = new Map<string, CardSample[]>()
  for (const pad of Object.values(cardPads)) {
    if (!pad.sample) {
      continue
    }
    const found = index.get(pad.sample.fingerprint)
    if (found) {
      found.push({ slot: pad.slot, sample: pad.sample })
    } else {
      index.set(pad.sample.fingerprint, [{ slot: pad.slot, sample: pad.sample }])
    }
  }
  return index
}

function matchOnCard(
  index: Map<string, CardSample[]>,
  cardPads: Record<PadId, Pad>,
  ref: { fingerprint: string; originSlot: number; fileName: string },
): CardSample | null {
  if (ref.fingerprint) {
    const candidates = index.get(ref.fingerprint) ?? []
    return candidates.find((it) => it.slot === ref.originSlot) ?? candidates[0] ?? null
  }

  const atOrigin = cardPads[padIdForSlot(ref.originSlot)]
  return atOrigin?.sample?.fileName === ref.fileName
    ? { slot: atOrigin.slot, sample: atOrigin.sample }
    : null
}

function keptOnCard(audio: ProjectAudioRef | null, base: Pad): boolean {
  if (!audio) {
    return base.audio === null
  }
  if (audio.kind === 'path' || !base.sample) {
    return false
  }
  return audio.fingerprint
    ? base.sample.fingerprint === audio.fingerprint
    : base.sample.fileName === audio.fileName
}

function withSourceOf(audio: AudioRef | null, saved: ProjectAudioRef | null): AudioRef | null {
  return audio?.kind === 'card' && saved?.kind === 'card' && saved.sourcePath
    ? { ...audio, sourcePath: saved.sourcePath }
    : audio
}

export function resolveProject(
  project: Project,
  cardPads: Record<PadId, Pad>,
  missingPaths: ReadonlySet<string> = new Set(),
  choice: RestoreChoice = KEEP_THE_CARD,
): ProjectResolution {
  const index = samplesByFingerprint(cardPads)
  const pads: Record<PadId, Pad> = {}
  const intents: Record<PadId, PadIntent> = {}
  const orphans: Record<PadId, MissingSource> = {}
  const moved: PadId[] = []
  const fromSource: PadId[] = []
  const divergence: Divergence = { onCard: 0, fromDisk: 0, missing: 0, extra: 0 }
  const summary: ResolutionSummary = {
    resolved: 0,
    moved: 0,
    fromDisk: 0,
    missing: 0,
    keeping: 0,
    cleared: 0,
  }

  const locate = (audio: ProjectAudioRef): Located | null => {
    if (audio.kind === 'path') {
      return missingPaths.has(audio.path)
        ? null
        : { kind: 'disk', path: audio.path, fromSource: false }
    }
    const found = matchOnCard(index, cardPads, audio)
    if (found) {
      return { kind: 'card', found }
    }
    return audio.sourcePath && !missingPaths.has(audio.sourcePath)
      ? { kind: 'disk', path: audio.sourcePath, fromSource: true }
      : null
  }

  for (const pad of Object.values(cardPads)) {
    pads[pad.id] = { ...pad, settings: { ...pad.settings } }
    intents[pad.id] = keepIntent()
  }

  for (const slot of project.slots) {
    if (slot.slot < 0 || slot.slot >= PAD_COUNT) {
      continue
    }
    const base = cardPads[padIdForSlot(slot.slot)]
    if (!base) {
      continue
    }

    const id = base.id
    const settings = settingsOf(slot.edit)

    const place = (audio: ProjectAudioRef, located: Located | null) => {
      if (!located) {
        orphans[id] = { audio, settings }
        summary.missing++
        return
      }
      if (located.kind === 'card') {
        const { found } = located
        const placed = cardAudio(
          found.slot,
          found.sample,
          audio.kind === 'card' ? audio.sourcePath : undefined,
        )
        pads[id] = { ...base, audio: placed, sample: found.sample, settings }
        intents[id] = sampleIntent(placed)
        if (audio.kind === 'card' && found.slot !== audio.originSlot) {
          moved.push(id)
        }
        summary.resolved++
        return
      }
      const placed = diskAudio(located.path)
      pads[id] = { ...base, audio: placed, sample: null, settings }
      intents[id] = sampleIntent(placed)
      if (located.fromSource) {
        fromSource.push(id)
        summary.fromDisk++
      } else {
        summary.resolved++
      }
    }

    if (slot.intent === 'keep') {
      if (keptOnCard(slot.audio, base)) {
        pads[id] = { ...base, audio: withSourceOf(base.audio, slot.audio), settings }
        summary.keeping++
        continue
      }

      if (!slot.audio) {
        divergence.extra++
        if (choice.clearExtras) {
          pads[id] = { ...base, audio: null, sample: null, settings }
          intents[id] = clearIntent()
          summary.cleared++
        } else {
          summary.keeping++
        }
        continue
      }

      const located = locate(slot.audio)
      if (!located) {
        divergence.missing++
      } else if (located.kind === 'card') {
        divergence.onCard++
      } else {
        divergence.fromDisk++
      }

      if (choice.restore) {
        place(slot.audio, located)
      } else {
        summary.keeping++
      }
      continue
    }

    if (slot.intent === 'clear' || !slot.audio) {
      pads[id] = { ...base, audio: null, sample: null, settings }
      intents[id] = clearIntent()
      continue
    }

    place(slot.audio, locate(slot.audio))
  }

  summary.moved = moved.length
  return { pads, intents, orphans, moved, fromSource, divergence, summary }
}

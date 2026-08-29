import type { SampleInfo } from '@/card'
import {
  PAD_COUNT,
  cardAudio,
  diskAudio,
  padIdForSlot,
  type AudioRef,
  type Pad,
  type PadId,
  type PadSettings,
} from '@/domain/pad'
import { clearIntent, keepIntent, sampleIntent, type PadIntent } from '@/domain/plan'
import {
  PROJECT_VERSION,
  type Project,
  type ProjectAudioRef,
  type ProjectEdit,
  type ProjectSlot,
} from '@/projects'

export interface OrphanPad {
  padId: PadId
  audio: ProjectAudioRef
  settings: PadSettings
}

export interface ResolutionSummary {
  resolved: number
  moved: number
  missing: number
  keeping: number
}

export interface ProjectResolution {
  pads: Record<PadId, Pad>
  intents: Record<PadId, PadIntent>
  orphans: OrphanPad[]
  moved: PadId[]
  summary: ResolutionSummary
}

export interface Portability {
  fromDisk: number
  fromCard: number
}

export function portabilityOf(project: Project): Portability {
  const refs = project.slots.map((slot) => slot.audio).filter((audio) => audio !== null)
  return {
    fromDisk: refs.filter((audio) => audio.kind === 'path').length,
    fromCard: refs.filter((audio) => audio.kind === 'card').length,
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
  return {
    kind: 'card',
    originSlot: audio.originSlot,
    fileName: audio.fileName,
    fingerprint: sample?.fingerprint ?? '',
  }
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
  const candidates = index.get(ref.fingerprint) ?? []
  const matched = candidates.find((it) => it.slot === ref.originSlot) ?? candidates[0] ?? null
  if (matched) {
    return matched
  }

  const atOrigin = cardPads[padIdForSlot(ref.originSlot)]
  return atOrigin?.sample?.fileName === ref.fileName
    ? { slot: atOrigin.slot, sample: atOrigin.sample }
    : null
}

export function resolveProject(
  project: Project,
  cardPads: Record<PadId, Pad>,
  missingPaths: ReadonlySet<string> = new Set(),
): ProjectResolution {
  const index = samplesByFingerprint(cardPads)
  const pads: Record<PadId, Pad> = {}
  const intents: Record<PadId, PadIntent> = {}
  const orphans: OrphanPad[] = []
  const moved: PadId[] = []
  let resolved = 0
  let keeping = 0

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
    const orphaned = (audio: ProjectAudioRef) => {
      orphans.push({ padId: id, audio, settings })
      pads[id] = { ...base, settings: { ...base.settings } }
      intents[id] = keepIntent()
    }

    if (slot.intent === 'keep') {
      pads[id] = { ...base, settings }
      keeping++
      continue
    }

    if (slot.intent === 'clear' || !slot.audio) {
      pads[id] = { ...base, audio: null, sample: null, settings }
      intents[id] = clearIntent()
      continue
    }

    if (slot.audio.kind === 'path') {
      if (missingPaths.has(slot.audio.path)) {
        orphaned(slot.audio)
        continue
      }
      const audio = diskAudio(slot.audio.path)
      pads[id] = { ...base, audio, sample: null, settings }
      intents[id] = sampleIntent(audio)
      resolved++
      continue
    }

    const match = matchOnCard(index, cardPads, slot.audio)
    if (!match) {
      orphaned(slot.audio)
      continue
    }

    if (match.slot !== slot.audio.originSlot) {
      moved.push(id)
    }
    const audio = cardAudio(match.slot, match.sample)
    pads[id] = { ...base, audio, sample: match.sample, settings }
    intents[id] = sampleIntent(audio)
    resolved++
  }

  return {
    pads,
    intents,
    orphans,
    moved,
    summary: { resolved, moved: moved.length, missing: orphans.length, keeping },
  }
}

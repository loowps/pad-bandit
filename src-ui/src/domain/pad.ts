import type { CardSlot, SampleInfo, TempoMode } from '@/card'

export const BANK_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const

export type BankName = (typeof BANK_NAMES)[number]

export const PADS_PER_BANK = 12

export const PAD_COUNT = BANK_NAMES.length * PADS_PER_BANK

export type PadId = string

export interface DiskAudioRef {
  kind: 'path'
  path: string
}

export interface CardAudioRef {
  kind: 'card'
  path: string
  originSlot: number
  fileName: string
}

export type AudioRef = DiskAudioRef | CardAudioRef

export interface PadSettings {
  volume: number
  lofi: boolean
  loop: boolean
  gate: boolean
  reverse: boolean
  tempoMode: TempoMode
  originalTempo: number
  userTempo: number
  startFrame: number
  endFrame: number
}

export interface Pad {
  id: PadId
  slot: number
  audio: AudioRef | null
  sample: SampleInfo | null
  settings: PadSettings
}

export function bankOfSlot(slot: number): BankName {
  const bank = BANK_NAMES[Math.floor(slot / PADS_PER_BANK)]
  if (!bank) {
    throw new RangeError(`slot ${slot} is outside the ${PAD_COUNT} available pads`)
  }
  return bank
}

export function numberInBank(slot: number): number {
  return (slot % PADS_PER_BANK) + 1
}

export function padIdAfterBankSwap(slot: number, first: BankName, second: BankName): PadId {
  const bank = bankOfSlot(slot)
  if (bank !== first && bank !== second) {
    return padIdForSlot(slot)
  }
  return `${bank === first ? second : first}${numberInBank(slot)}`
}

export function padIdForSlot(slot: number): PadId {
  return `${bankOfSlot(slot)}${numberInBank(slot)}`
}

export function diskAudio(path: string): DiskAudioRef {
  return { kind: 'path', path }
}

export function cardAudio(originSlot: number, sample: SampleInfo): CardAudioRef {
  return { kind: 'card', path: sample.path, originSlot, fileName: sample.fileName }
}

export function createDefaultSettings(): PadSettings {
  return {
    volume: 127,
    lofi: false,
    loop: false,
    gate: true,
    reverse: false,
    tempoMode: 'off',
    originalTempo: 120,
    userTempo: 120,
    startFrame: 0,
    endFrame: 0,
  }
}

export function createPad(slot: number): Pad {
  return {
    id: padIdForSlot(slot),
    slot,
    audio: null,
    sample: null,
    settings: createDefaultSettings(),
  }
}

export function padFromSlot(slot: CardSlot): Pad {
  const { sample } = slot
  return {
    id: padIdForSlot(slot.slot),
    slot: slot.slot,
    audio: sample ? cardAudio(slot.slot, sample) : null,
    sample,
    settings: {
      ...slot.settings,
      startFrame: sample?.startFrame ?? 0,
      endFrame: sample?.endFrame ?? 0,
    },
  }
}

export function createEmptyCard(): Record<PadId, Pad> {
  const pads: Record<PadId, Pad> = {}
  for (let slot = 0; slot < PAD_COUNT; slot++) {
    const pad = createPad(slot)
    pads[pad.id] = pad
  }
  return pads
}

export function audioSourceName(audio: AudioRef): string {
  const segments = audio.path.split(/[\\/]/)
  return segments[segments.length - 1] ?? audio.path
}

export interface PadSnapshot {
  settings: PadSettings
  audio: AudioRef | null
  sample: SampleInfo | null
}

export function sameAudioRef(first: AudioRef | null, second: AudioRef | null): boolean {
  if (!first || !second) {
    return first === second
  }
  if (first.kind === 'card' && second.kind === 'card') {
    return first.originSlot === second.originSlot && first.fileName === second.fileName
  }
  return first.kind === second.kind && first.path === second.path
}

export function sameSettings(first: PadSettings, second: PadSettings): boolean {
  const keys = Object.keys(first) as (keyof PadSettings)[]
  return keys.every((key) => first[key] === second[key])
}

export function padMatchesSnapshot(pad: Pad, snapshot: PadSnapshot): boolean {
  return sameAudioRef(pad.audio, snapshot.audio) && sameSettings(pad.settings, snapshot.settings)
}

export function snapshotOf(pad: Pad): PadSnapshot {
  return { settings: { ...pad.settings }, audio: pad.audio, sample: pad.sample }
}

export function padFromSnapshot(id: PadId, slot: number, snapshot: PadSnapshot): Pad {
  return {
    id,
    slot,
    audio: snapshot.audio,
    sample: snapshot.sample,
    settings: { ...snapshot.settings },
  }
}

export function isPadEmpty(pad: Pad): boolean {
  return pad.audio === null && sameSettings(pad.settings, createDefaultSettings())
}

export type { SampleInfo }

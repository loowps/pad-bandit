import { invoke } from '@tauri-apps/api/core'

export type SampleFormat = 'wave' | 'aiff' | 'unknown'

export type TempoMode = 'off' | 'pattern' | 'user'

export interface CardPadSettings {
  volume: number
  lofi: boolean
  loop: boolean
  gate: boolean
  reverse: boolean
  tempoMode: TempoMode
  originalTempo: number
  userTempo: number
}

export interface SampleInfo {
  fileName: string
  path: string
  fingerprint: string
  format: SampleFormat
  channels: number
  frames: number
  sizeBytes: number
  startFrame: number
  endFrame: number
}

export interface CardSlot {
  slot: number
  settings: CardPadSettings
  sample: SampleInfo | null
}

export interface CardState {
  root: string
  fingerprint: string
  slots: CardSlot[]
}

export function readCard(): Promise<CardState> {
  return invoke<CardState>('card_read')
}

export interface CardPresence {
  present: boolean
  fingerprint: string | null
}

export function readCardPresence(): Promise<CardPresence> {
  return invoke<CardPresence>('card_presence')
}

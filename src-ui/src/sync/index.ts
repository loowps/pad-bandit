import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { CardPadSettings, CardState } from '@/card'

export type PlannedAction =
  | { kind: 'settings' }
  | { kind: 'move'; fromSlot: number }
  | { kind: 'write'; source: string }
  | { kind: 'delete' }

export interface PlannedEdit {
  settings: CardPadSettings
  startFrame: number
  endFrame: number
}

export interface PlannedSlot {
  slot: number
  action: PlannedAction
  edit: PlannedEdit
}

export interface SyncPlan {
  cardFingerprint: string
  slots: PlannedSlot[]
}

export type Problem =
  | { kind: 'cardChanged' }
  | { kind: 'unknownSlot'; slot: number }
  | { kind: 'notEnoughRoom'; needed: number; available: number }
  | { kind: 'sourceUnreadable'; slot: number; source: string; reason: string }
  | { kind: 'sampleTooLong'; slot: number; bytes: number; cap: number }
  | { kind: 'nothingAtOriginSlot'; slot: number; fromSlot: number }

export interface SizedSlot {
  slot: number
  bytes: number
}

export interface Preflight {
  problems: Problem[]
  sizes: SizedSlot[]
  bytesToWrite: number
  bytesToFree: number
  freeSpace: number
}

export type SyncPhase = 'moving' | 'deleting' | 'converting' | 'recording' | 'verifying'

export interface SyncProgress {
  slot: number | null
  phase: SyncPhase
  slotsDone: number
  slotsTotal: number
  bytesDone: number
  bytesTotal: number
}

export interface SlotFailure {
  slot: number
  reason: string
}

export interface SyncOutcome {
  applied: number[]
  skipped: number[]
  failures: SlotFailure[]
  cancelled: boolean
  verified: boolean
}

export interface SyncResult {
  outcome: SyncOutcome
  card: CardState
}

export function preflightSync(plan: SyncPlan): Promise<Preflight> {
  return invoke<Preflight>('sync_preflight', { plan })
}

export function applySync(plan: SyncPlan): Promise<SyncResult> {
  return invoke<SyncResult>('sync_apply', { plan })
}

export function cancelSync(): Promise<void> {
  return invoke<void>('sync_cancel')
}

export function onSyncProgress(handler: (progress: SyncProgress) => void): Promise<UnlistenFn> {
  return listen<SyncProgress>('sync:progress', (event) => handler(event.payload))
}

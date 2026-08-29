
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

export function applySync(plan: SyncPlan): Promise<SyncResult> {
  return invoke<SyncResult>('sync_apply', { plan })
}

export function cancelSync(): Promise<void> {
  return invoke<void>('sync_cancel')
}

export function onSyncProgress(handler: (progress: SyncProgress) => void): Promise<UnlistenFn> {
  return listen<SyncProgress>('sync:progress', (event) => handler(event.payload))
}

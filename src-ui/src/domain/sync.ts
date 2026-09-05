import { audioSourceName, type Pad, type PadId, padIdForSlot } from '@/domain/pad'
import { editOf } from '@/domain/project'
import type { PadChange } from '@/domain/plan'
import type { PlannedAction, PlannedSlot, SyncOutcome, SyncPlan } from '@/sync'

export interface PreviewRow {
  padId: PadId
  slot: number
  headline: string
  detail: string
  action: PlannedAction
}

export function plannedAction(change: PadChange): PlannedAction | null {
  switch (change.status) {
    case 'settings':
      return { kind: 'settings' }
    case 'removed':
      return { kind: 'delete' }
    case 'moved':
      return change.fromSlot === null ? null : { kind: 'move', fromSlot: change.fromSlot }
    case 'added':
    case 'replaced':
      return change.audio?.kind === 'path' ? { kind: 'write', source: change.audio.path } : null
  }
}

export function syncPlan(
  cardFingerprint: string,
  changes: PadChange[],
  pads: Record<PadId, Pad>,
): SyncPlan {
  const slots: PlannedSlot[] = []

  for (const change of changes) {
    const action = plannedAction(change)
    const pad = pads[change.padId]
    if (action && pad) {
      slots.push({ slot: change.slot, action, edit: editOf(pad.settings) })
    }
  }

  return { cardFingerprint, slots }
}

export function previewRows(changes: PadChange[], pads: Record<PadId, Pad>): PreviewRow[] {
  const rows: PreviewRow[] = []

  for (const change of changes) {
    const action = plannedAction(change)
    const pad = pads[change.padId]
    if (!action || !pad) {
      continue
    }
    rows.push({
      padId: change.padId,
      slot: change.slot,
      headline: headlineOf(action),
      detail: detailOf(change, action),
      action,
    })
  }

  return rows
}

function headlineOf(action: PlannedAction): string {
  switch (action.kind) {
    case 'settings':
      return 'settings'
    case 'move':
      return 'move'
    case 'write':
      return 'new sample'
    case 'delete':
      return 'delete sample'
  }
}

function detailOf(change: PadChange, action: PlannedAction): string {
  switch (action.kind) {
    case 'settings':
      return change.previousFileName ?? 'parameters only'
    case 'move':
      return `from ${padIdForSlot(action.fromSlot)}`
    case 'write':
      return sourceName(action.source)
    case 'delete':
      return change.previousFileName ?? 'the sample on this pad'
  }
}

function sourceName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function outcomeSummary(outcome: SyncOutcome): string {
  const parts = [`${outcome.applied.length} pad${outcome.applied.length === 1 ? '' : 's'} written`]
  if (outcome.failures.length) {
    parts.push(`${outcome.failures.length} failed`)
  }
  if (outcome.cancelled) {
    parts.push(`cancelled, ${outcome.skipped.length} skipped`)
  }
  if (!outcome.verified) {
    parts.push('the card did not read back as expected')
  }
  return parts.join(' · ')
}

export function outcomeWentWell(outcome: SyncOutcome): boolean {
  return outcome.verified && outcome.failures.length === 0 && !outcome.cancelled
}

export function padLabel(pad: Pad): string {
  return pad.audio ? audioSourceName(pad.audio) : 'empty'
}

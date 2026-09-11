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

export function linkedPadIds(rows: PreviewRow[], padId: PadId): PadId[] {
  const bySlot = new Map(rows.map((row) => [row.slot, row]))
  const linked = new Set<PadId>()
  const waiting = rows.filter((row) => row.padId === padId)

  for (let row = waiting.pop(); row; row = waiting.pop()) {
    if (linked.has(row.padId)) {
      continue
    }
    linked.add(row.padId)
    const slot = row.slot
    const origin = row.action.kind === 'move' ? bySlot.get(row.action.fromSlot) : undefined
    if (origin) {
      waiting.push(origin)
    }
    waiting.push(
      ...rows.filter((other) => other.action.kind === 'move' && other.action.fromSlot === slot),
    )
  }

  return [...linked]
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

export function rewrittenSlots(plan: SyncPlan, outcome: SyncOutcome): Set<number> {
  const applied = new Set(outcome.applied)
  const rewritten = new Set(applied)
  for (const planned of plan.slots) {
    if (applied.has(planned.slot) && planned.action.kind === 'move') {
      rewritten.add(planned.action.fromSlot)
    }
  }
  return rewritten
}

export function outcomeWentWell(outcome: SyncOutcome): boolean {
  return outcome.verified && outcome.failures.length === 0 && !outcome.cancelled
}

export function padLabel(pad: Pad): string {
  return pad.audio ? audioSourceName(pad.audio) : 'empty'
}

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  applySync,
  cancelSync,
  onSyncProgress,
  type Preflight,
  preflightSync,
  type Problem,
  type SyncOutcome,
  type SyncProgress,
} from '@/sync'
import { type PreviewRow, previewRows, syncPlan } from '@/domain/sync'
import { useCardStore } from '@/stores/card'
import { usePadsStore } from '@/stores/pads'
import type { PadId } from '@/domain/pad'

export const useSyncStore = defineStore('sync', () => {
  const isOpen = ref(false)
  const deselected = ref<Set<PadId>>(new Set())
  const report = ref<Preflight | null>(null)
  const checking = ref(false)
  const error = ref<string | null>(null)

  const rows = computed<PreviewRow[]>(() => {
    const pads = usePadsStore()
    return previewRows(pads.plan, pads.byId)
  })

  const selected = computed<PreviewRow[]>(() =>
    rows.value.filter((row) => !deselected.value.has(row.padId)),
  )

  const hasSelection = computed(() => selected.value.length > 0)

  const problemsBySlot = computed<Map<number, Problem[]>>(() => {
    const found = new Map<number, Problem[]>()
    for (const problem of report.value?.problems ?? []) {
      if ('slot' in problem) {
        found.set(problem.slot, [...(found.get(problem.slot) ?? []), problem])
      }
    }
    return found
  })

  const blockers = computed<Problem[]>(() =>
    (report.value?.problems ?? []).filter((problem) => !('slot' in problem)),
  )

  const running = ref(false)
  const progress = ref<SyncProgress | null>(null)
  const outcome = ref<SyncOutcome | null>(null)

  const canSync = computed(
    () =>
      hasSelection.value &&
      report.value !== null &&
      report.value.problems.length === 0 &&
      useCardStore().presence === 'present' &&
      !checking.value &&
      !running.value,
  )

  const percent = computed(() => {
    const current = progress.value
    if (!current || current.bytesTotal === 0) {
      return current ? Math.round((current.slotsDone / current.slotsTotal) * 100) : 0
    }
    return Math.round((current.bytesDone / current.bytesTotal) * 100)
  })

  function toggle(padId: PadId): void {
    const next = new Set(deselected.value)
    if (!next.delete(padId)) {
      next.add(padId)
    }
    deselected.value = next
  }

  function selectAll(): void {
    deselected.value = new Set()
  }

  function open(): void {
    isOpen.value = true
    void check()
  }

  function close(): void {
    isOpen.value = false
    report.value = null
    error.value = null
  }

  async function check(): Promise<Preflight | null> {
    const card = useCardStore()
    if (!card.fingerprint) {
      error.value = 'No card has been read yet.'
      return null
    }

    checking.value = true
    error.value = null
    try {
      report.value = await preflightSync(planNow(card.fingerprint))
      return report.value
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      report.value = null
      return null
    } finally {
      checking.value = false
    }
  }

  function planNow(fingerprint: string) {
    const pads = usePadsStore()
    return syncPlan(
      fingerprint,
      pads.plan.filter((change) => !deselected.value.has(change.padId)),
      pads.byId,
    )
  }

  async function run(): Promise<SyncOutcome | null> {
    const card = useCardStore()
    if (!card.fingerprint || !canSync.value) {
      return null
    }

    running.value = true
    outcome.value = null
    error.value = null
    progress.value = null

    let stop: (() => void) | null = null
    card.pausePresence()
    try {
      stop = await onSyncProgress((update) => {
        progress.value = update
      })
      const result = await applySync(planNow(card.fingerprint))
      await card.adopt(result.card)
      deselected.value = new Set()
      outcome.value = result.outcome
      report.value = null
      return result.outcome
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return null
    } finally {
      stop?.()
      card.resumePresence()
      running.value = false
      progress.value = null
    }
  }

  async function cancel(): Promise<void> {
    try {
      await cancelSync()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  return {
    isOpen,
    deselected,
    report,
    checking,
    error,
    running,
    progress,
    outcome,
    percent,
    rows,
    selected,
    hasSelection,
    problemsBySlot,
    blockers,
    canSync,
    toggle,
    selectAll,
    open,
    close,
    check,
    run,
    cancel,
  }
})

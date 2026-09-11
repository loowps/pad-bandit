import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { CardState } from '@/card'
import { useNoticesStore } from '@/stores/notices'
import {
  type AudioRef,
  BANK_NAMES,
  type BankName,
  createDefaultSettings,
  createEmptyCard,
  type Pad,
  padFromSlot,
  padFromSnapshot,
  type PadId,
  padIdForSlot,
  PADS_PER_BANK,
  type PadSettings,
  type PadSnapshot,
  snapshotOf,
} from '@/domain/pad'
import {
  cardPlan,
  clearIntent,
  keepIntent,
  type PadChange,
  type PadIntent,
  sampleIntent,
} from '@/domain/plan'
import { type DropMode, planDrop } from '@/domain/fill'
import type { MissingSource, ProjectResolution } from '@/domain/project'

export interface Bank {
  name: BankName
  pads: Pad[]
}

interface FilledPad {
  padId: PadId
  slot: number
  snapshot: PadSnapshot
  intent: PadIntent
  missing: MissingSource | null
}

interface FillRecord {
  requested: number
  mode: DropMode
  filled: FilledPad[]
}

const FILL_NOTICE = 'pads:fill'

export const usePadsStore = defineStore('pads', () => {
  const byId = ref<Record<PadId, Pad>>(createEmptyCard())

  const allPads = computed<Pad[]>(() => Object.values(byId.value))

  function takeSnapshots(): Record<PadId, PadSnapshot> {
    const snapshots: Record<PadId, PadSnapshot> = {}
    for (const pad of Object.values(byId.value)) {
      snapshots[pad.id] = snapshotOf(pad)
    }
    return snapshots
  }

  function allKeeping(): Record<PadId, PadIntent> {
    const intents: Record<PadId, PadIntent> = {}
    for (const id of Object.keys(byId.value)) {
      intents[id] = keepIntent()
    }
    return intents
  }

  const snapshotById = shallowRef<Record<PadId, PadSnapshot>>(takeSnapshots())
  const intentById = ref<Record<PadId, PadIntent>>(allKeeping())
  const fillRecord = shallowRef<FillRecord | null>(null)
  const missingById = ref<Record<PadId, MissingSource>>({})

  const missingCount = computed(() => Object.keys(missingById.value).length)

  const banks = computed<Bank[]>(() =>
    BANK_NAMES.map((name, index) => ({
      name,
      pads: allPads.value.slice(index * PADS_PER_BANK, (index + 1) * PADS_PER_BANK),
    })),
  )

  const plan = computed<PadChange[]>(() =>
    cardPlan(allPads.value, intentById.value, snapshotById.value),
  )

  const changeById = computed<Record<PadId, PadChange>>(() =>
    Object.fromEntries(plan.value.map((change) => [change.padId, change])),
  )

  const cardPads = computed<Record<PadId, Pad>>(() =>
    Object.fromEntries(
      allPads.value.map((pad) => [
        pad.id,
        padFromSnapshot(pad.id, pad.slot, snapshotById.value[pad.id] ?? snapshotOf(pad)),
      ]),
    ),
  )

  const preparedPadIds = computed<PadId[]>(() => plan.value.map((change) => change.padId))

  const hasPreparedPads = computed(() => plan.value.length > 0)

  const assignedAudioPaths = computed<Set<string>>(
    () => new Set(allPads.value.flatMap((pad) => (pad.audio ? [pad.audio.path] : []))),
  )

  function padById(id: PadId): Pad | undefined {
    return byId.value[id]
  }

  function changeFor(id: PadId): PadChange | null {
    return changeById.value[id] ?? null
  }

  function isPrepared(id: PadId): boolean {
    return id in changeById.value
  }

  function usesAudioPath(path: string): boolean {
    return assignedAudioPaths.value.has(path)
  }

  function missingFor(id: PadId): MissingSource | null {
    return missingById.value[id] ?? null
  }

  function setMissing(id: PadId, source: MissingSource | null): void {
    if (source) {
      missingById.value[id] = source
    } else {
      delete missingById.value[id]
    }
  }

  function forgetMissing(id: PadId): void {
    setMissing(id, null)
  }

  function updateSettings(id: PadId, changes: Partial<PadSettings>): void {
    const pad = byId.value[id]
    if (pad) {
      Object.assign(pad.settings, changes)
    }
  }

  function sampleBehind(audio: AudioRef | null) {
    return audio?.kind === 'card'
      ? (snapshotById.value[padIdForSlot(audio.originSlot)]?.sample ?? null)
      : null
  }

  function assignAudio(id: PadId, audio: AudioRef | null): void {
    const pad = byId.value[id]
    if (!pad) {
      return
    }
    pad.audio = audio
    pad.sample = sampleBehind(audio)
    pad.settings = {
      ...pad.settings,
      startFrame: pad.sample?.startFrame ?? 0,
      endFrame: pad.sample?.endFrame ?? 0,
    }
    intentById.value[id] = audio ? sampleIntent(audio) : clearIntent()
    setMissing(id, null)
  }

  function relink(id: PadId, audio: AudioRef): void {
    const missing = missingFor(id)
    assignAudio(id, audio)
    const pad = byId.value[id]
    if (missing && pad) {
      pad.settings = { ...missing.settings }
    }
  }

  function fillFrom(startSlot: number, sources: AudioRef[], mode: DropMode = 'fill'): PadId[] {
    const targets = planDrop(byId.value, startSlot, sources.length, mode)
    const filled = targets.flatMap<FilledPad>((padId) => {
      const pad = byId.value[padId]
      return pad
        ? [
            {
              padId,
              slot: pad.slot,
              snapshot: snapshotOf(pad),
              intent: intentById.value[padId] ?? keepIntent(),
              missing: missingFor(padId),
            },
          ]
        : []
    })

    targets.forEach((padId, index) => {
      const audio = sources[index]
      if (audio) {
        assignAudio(padId, audio)
      }
    })

    fillRecord.value = { requested: sources.length, mode, filled }
    announceFill()
    return targets
  }

  function announceFill(): void {
    const record = fillRecord.value
    if (!record) {
      return
    }

    const missed = record.requested - record.filled.length
    const verb = record.mode === 'overwrite' ? 'Overwrote' : 'Filled'

    useNoticesStore().notify({
      severity: missed > 0 ? 'warning' : 'info',
      source: FILL_NOTICE,
      title:
        missed > 0
          ? `${verb} ${record.filled.length} of ${record.requested} pads — ${missed} did not fit`
          : `${verb} ${record.filled.length} pads`,
      action: { label: 'Undo', run: undoFill },
    })
  }

  function undoFill(): void {
    for (const { padId, slot, snapshot, intent, missing } of fillRecord.value?.filled ?? []) {
      byId.value[padId] = padFromSnapshot(padId, slot, snapshot)
      intentById.value[padId] = intent
      setMissing(padId, missing)
    }
    forgetFill()
  }

  function forgetFill(): void {
    fillRecord.value = null
    useNoticesStore().resolve(FILL_NOTICE)
  }

  function clearPad(id: PadId): void {
    const pad = byId.value[id]
    if (!pad) {
      return
    }
    pad.audio = null
    pad.sample = null
    pad.settings = createDefaultSettings()
    intentById.value[id] = clearIntent()
    setMissing(id, null)
  }

  function revertPad(id: PadId): void {
    const snapshot = snapshotById.value[id]
    const pad = byId.value[id]
    if (!snapshot || !pad) {
      return
    }
    byId.value[id] = padFromSnapshot(id, pad.slot, snapshot)
    intentById.value[id] = keepIntent()
  }

  function discardChanges(): void {
    for (const id of preparedPadIds.value) {
      revertPad(id)
    }
    missingById.value = {}
    forgetFill()
  }

  function loadFromCard(state: CardState): void {
    const loaded: Record<PadId, Pad> = {}
    for (const slot of state.slots) {
      const pad = padFromSlot(slot)
      loaded[pad.id] = pad
    }
    byId.value = loaded
    adoptSnapshot()
  }

  function adoptCard(state: CardState, rewritten: ReadonlySet<number>): void {
    const untouched = allPads.value.filter(
      (pad) =>
        !rewritten.has(pad.slot) &&
        !(pad.audio?.kind === 'card' && rewritten.has(pad.audio.originSlot)),
    )
    const pending = untouched
      .filter((pad) => isPrepared(pad.id))
      .map((pad) => ({
        pad: padFromSnapshot(pad.id, pad.slot, snapshotOf(pad)),
        intent: intentById.value[pad.id] ?? keepIntent(),
      }))
    const stillMissing = untouched.flatMap((pad) => {
      const source = missingFor(pad.id)
      return source ? [[pad.id, source] as const] : []
    })

    loadFromCard(state)
    for (const { pad, intent } of pending) {
      byId.value[pad.id] = pad
      intentById.value[pad.id] = intent
    }
    missingById.value = Object.fromEntries(stillMissing)
  }

  function intentAfterExchange(pad: Pad, had: AudioRef | null): void {
    if (pad.audio) {
      intentById.value[pad.id] = sampleIntent(pad.audio)
    } else if (had) {
      intentById.value[pad.id] = clearIntent()
    }
  }

  function exchange(first: Pad, second: Pad): void {
    const [hadFirst, hadSecond] = [first.audio, second.audio]
    const [missingFirst, missingSecond] = [missingFor(first.id), missingFor(second.id)]
    setMissing(first.id, missingSecond)
    setMissing(second.id, missingFirst)
    ;[first.audio, second.audio] = [hadSecond, hadFirst]
    ;[first.sample, second.sample] = [second.sample, first.sample]
    ;[first.settings, second.settings] = [second.settings, first.settings]
    intentAfterExchange(first, hadFirst)
    intentAfterExchange(second, hadSecond)
  }

  function swapPads(first: PadId, second: PadId): void {
    const source = byId.value[first]
    const target = byId.value[second]
    if (!source || !target || source === target || !(source.audio ?? target.audio)) {
      return
    }
    exchange(source, target)
  }

  function swapBanks(first: BankName, second: BankName): void {
    if (first === second) {
      return
    }

    const from = BANK_NAMES.indexOf(first) * PADS_PER_BANK
    const to = BANK_NAMES.indexOf(second) * PADS_PER_BANK

    for (let number = 0; number < PADS_PER_BANK; number++) {
      const source = byId.value[padIdForSlot(from + number)]
      const target = byId.value[padIdForSlot(to + number)]
      if (source && target) {
        exchange(source, target)
      }
    }
  }

  function adoptSnapshot(): void {
    snapshotById.value = takeSnapshots()
    intentById.value = allKeeping()
    missingById.value = {}
    forgetFill()
  }

  function applyProject(resolution: Pick<ProjectResolution, 'pads' | 'intents' | 'orphans'>): void {
    byId.value = resolution.pads
    intentById.value = resolution.intents
    missingById.value = { ...resolution.orphans }
    forgetFill()
  }

  function resetCard(): void {
    byId.value = createEmptyCard()
    adoptSnapshot()
  }

  return {
    byId,
    snapshotById,
    intentById,
    allPads,
    cardPads,
    banks,
    plan,
    preparedPadIds,
    hasPreparedPads,
    missingCount,
    padById,
    changeFor,
    isPrepared,
    usesAudioPath,
    missingFor,
    forgetMissing,
    updateSettings,
    assignAudio,
    relink,
    fillFrom,
    clearPad,
    revertPad,
    discardChanges,
    loadFromCard,
    adoptCard,
    applyProject,
    swapPads,
    swapBanks,
    adoptSnapshot,
    resetCard,
  }
})

import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { CardState } from '@/card'
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
import type { ProjectResolution } from '@/domain/project'

export interface Bank {
  name: BankName
  pads: Pad[]
}

interface FilledPad {
  padId: PadId
  slot: number
  snapshot: PadSnapshot
  intent: PadIntent
}

interface FillRecord {
  requested: number
  mode: DropMode
  filled: FilledPad[]
}

export interface FillOutcome {
  filled: number
  requested: number
  mode: DropMode
}

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

  const lastFill = computed<FillOutcome | null>(() =>
    fillRecord.value
      ? {
          filled: fillRecord.value.filled.length,
          requested: fillRecord.value.requested,
          mode: fillRecord.value.mode,
        }
      : null,
  )

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
    intentById.value[id] = audio ? sampleIntent(audio) : clearIntent()
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
    return targets
  }

  function undoFill(): void {
    for (const { padId, slot, snapshot, intent } of fillRecord.value?.filled ?? []) {
      byId.value[padId] = padFromSnapshot(padId, slot, snapshot)
      intentById.value[padId] = intent
    }
    forgetFill()
  }

  function forgetFill(): void {
    fillRecord.value = null
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

  function intentAfterExchange(pad: Pad, had: AudioRef | null): void {
    if (pad.audio) {
      intentById.value[pad.id] = sampleIntent(pad.audio)
    } else if (had) {
      intentById.value[pad.id] = clearIntent()
    }
  }

  function exchange(first: Pad, second: Pad): void {
    const [hadFirst, hadSecond] = [first.audio, second.audio]
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
    forgetFill()
  }

  function applyProject(resolution: ProjectResolution): void {
    byId.value = resolution.pads
    intentById.value = resolution.intents
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
    lastFill,
    padById,
    changeFor,
    isPrepared,
    usesAudioPath,
    updateSettings,
    assignAudio,
    fillFrom,
    undoFill,
    forgetFill,
    clearPad,
    revertPad,
    discardChanges,
    loadFromCard,
    applyProject,
    swapPads,
    swapBanks,
    adoptSnapshot,
    resetCard,
  }
})

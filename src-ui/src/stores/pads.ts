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
import type { ProjectResolution } from '@/domain/project'

export interface Bank {
  name: BankName
  pads: Pad[]
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

  function swapPads(first: PadId, second: PadId): void {
    const source = byId.value[first]
    const target = byId.value[second]
    const onlyAudio = source?.audio ?? target?.audio
    if (!source || !target || source === target || !onlyAudio) {
      return
    }

    if (source.audio && target.audio) {
      ;[source.audio, target.audio] = [target.audio, source.audio]
      ;[source.sample, target.sample] = [target.sample, source.sample]
      ;[source.settings, target.settings] = [target.settings, source.settings]
      intentById.value[source.id] = sampleIntent(source.audio)
      intentById.value[target.id] = sampleIntent(target.audio)
      return
    }

    const [filled, empty] = source.audio ? [source, target] : [target, source]
    empty.audio = filled.audio
    empty.sample = filled.sample
    empty.settings = filled.settings
    filled.audio = null
    filled.sample = null
    filled.settings = createDefaultSettings()
    intentById.value[empty.id] = sampleIntent(onlyAudio)
    intentById.value[filled.id] = clearIntent()
  }

  function adoptSnapshot(): void {
    snapshotById.value = takeSnapshots()
    intentById.value = allKeeping()
  }

  function applyProject(resolution: ProjectResolution): void {
    byId.value = resolution.pads
    intentById.value = resolution.intents
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
    padById,
    changeFor,
    isPrepared,
    usesAudioPath,
    updateSettings,
    assignAudio,
    clearPad,
    revertPad,
    discardChanges,
    loadFromCard,
    applyProject,
    swapPads,
    adoptSnapshot,
    resetCard,
  }
})

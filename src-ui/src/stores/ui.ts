import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { findUndecodable } from '@/audio'
import { baseName } from '@/filesystem'
import { useAudioStore } from '@/stores/audio'
import { usePadsStore } from '@/stores/pads'
import { type DropMode, padsInTheWay, planDrop } from '@/domain/fill'
import {
  type AudioRef,
  type BankName,
  type Pad,
  padIdAfterBankSwap,
  type PadId,
} from '@/domain/pad'

export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 480
export const SIDEBAR_DEFAULT_WIDTH = 240

export type DragPayload =
  | { source: 'pad'; padId: PadId }
  | { source: 'audio'; audio: AudioRef[] }
  | { source: 'bank'; bank: BankName }

export interface PendingDrop {
  padId: PadId
  slot: number
  sources: AudioRef[]
  inTheWay: number
}

export interface RefusedDrop {
  names: string[]
  reason: string
}

export interface SelectedAudioInfo {
  frames: number
  sampleRate: number
  channels: number
}

export const useUiStore = defineStore('ui', () => {
  const selectedPadId = ref<PadId | null>(null)
  const dragPayload = ref<DragPayload | null>(null)
  const dragOverPadId = ref<PadId | null>(null)
  const dragMode = ref<DropMode>('fill')
  const pendingDrop = ref<PendingDrop | null>(null)
  const refusedDrop = ref<RefusedDrop | null>(null)
  const isLoadingAudio = ref(false)
  const audioInfo = ref<SelectedAudioInfo | null>(null)
  const sidebarWidth = ref(SIDEBAR_DEFAULT_WIDTH)
  const playbackStartFrame = ref<number | null>(null)

  const selectedPad = computed<Pad | null>(() => {
    const pads = usePadsStore()
    return selectedPadId.value ? (pads.padById(selectedPadId.value) ?? null) : null
  })

  const previewedDrop = computed<{ startSlot: number; count: number } | null>(() => {
    const pending = pendingDrop.value
    if (pending) {
      return { startSlot: pending.slot, count: pending.sources.length }
    }

    const payload = dragPayload.value
    const overId = dragOverPadId.value
    if (payload?.source !== 'audio' || payload.audio.length < 2 || !overId) {
      return null
    }

    const startSlot = usePadsStore().padById(overId)?.slot
    return startSlot === undefined ? null : { startSlot, count: payload.audio.length }
  })

  const fillOrdinalById = computed<Record<PadId, number>>(() => {
    const drop = previewedDrop.value
    if (!drop) {
      return {}
    }

    const pads = usePadsStore()
    const targets = planDrop(pads.byId, drop.startSlot, drop.count, dragMode.value)
    return Object.fromEntries(targets.map((padId, index) => [padId, index + 1]))
  })

  function selectPad(id: PadId): void {
    if (selectedPadId.value === id) {
      return
    }
    selectedPadId.value = id
    playbackStartFrame.value = null
    useAudioStore().pause()
  }

  function followBankSwap(first: BankName, second: BankName): void {
    const pad = selectedPad.value
    if (pad) {
      selectedPadId.value = padIdAfterBankSwap(pad.slot, first, second)
    }
  }

  function setAudioInfo(info: SelectedAudioInfo | null): void {
    audioInfo.value = info
  }

  function setPlaybackStart(frame: number | null): void {
    playbackStartFrame.value = frame === null ? null : Math.max(0, Math.round(frame))
  }

  function setSidebarWidth(width: number): void {
    sidebarWidth.value = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
  }

  function startDrag(payload: DragPayload): void {
    dragPayload.value = payload
  }

  function dragOverPad(id: PadId): void {
    if (dragOverPadId.value !== id) {
      dragOverPadId.value = id
    }
  }

  function dragOutOfPad(id: PadId): void {
    if (dragOverPadId.value === id) {
      dragOverPadId.value = null
    }
  }

  function endDrag(): void {
    dragPayload.value = null
    dragOverPadId.value = null
  }

  async function dropAudio(padId: PadId, slot: number, sources: AudioRef[]): Promise<void> {
    const usable = await decodableAmong(sources)
    const [only] = usable

    if (!only) {
      return
    }

    if (usable.length === 1) {
      usePadsStore().assignAudio(padId, only)
      selectPad(padId)
      return
    }

    proposeDrop(padId, slot, usable)
  }

  async function decodableAmong(sources: AudioRef[]): Promise<AudioRef[]> {
    refusedDrop.value = null

    const refused = await findUndecodable(sources.map((source) => source.path)).catch(() => [])
    const [first] = refused
    if (!first) {
      return sources
    }

    refusedDrop.value = { names: refused.map((file) => baseName(file.path)), reason: first.reason }
    const rejected = new Set(refused.map((file) => file.path))
    return sources.filter((source) => !rejected.has(source.path))
  }

  function forgetRefusal(): void {
    refusedDrop.value = null
  }

  function proposeDrop(padId: PadId, slot: number, sources: AudioRef[]): void {
    const inTheWay = padsInTheWay(usePadsStore().byId, slot, sources.length)
    dragMode.value = 'fill'
    pendingDrop.value = { padId, slot, sources, inTheWay: inTheWay.length }

    if (inTheWay.length === 0) {
      commitDrop('fill')
    }
  }

  function previewDrop(mode: DropMode): void {
    if (pendingDrop.value) {
      dragMode.value = mode
    }
  }

  function commitDrop(mode: DropMode): void {
    const pending = pendingDrop.value
    if (!pending) {
      return
    }

    const [first] = usePadsStore().fillFrom(pending.slot, pending.sources, mode)
    closeDrop()
    if (first) {
      selectPad(first)
    }
  }

  function closeDrop(): void {
    pendingDrop.value = null
    dragMode.value = 'fill'
  }

  watch(() => usePadsStore().byId, closeDrop, { flush: 'sync' })

  return {
    selectedPadId,
    selectedPad,
    dragPayload,
    pendingDrop,
    refusedDrop,
    fillOrdinalById,
    isLoadingAudio,
    audioInfo,
    sidebarWidth,
    playbackStartFrame,
    setSidebarWidth,
    setAudioInfo,
    setPlaybackStart,
    selectPad,
    followBankSwap,
    startDrag,
    dragOverPad,
    dragOutOfPad,
    endDrag,
    dropAudio,
    forgetRefusal,
    previewDrop,
    commitDrop,
    closeDrop,
  }
})

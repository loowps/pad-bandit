import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useAudioStore } from '@/stores/audio'
import { usePadsStore } from '@/stores/pads'
import type { AudioRef, Pad, PadId } from '@/domain/pad'

export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 480
export const SIDEBAR_DEFAULT_WIDTH = 240

export type DragPayload = { source: 'pad'; padId: PadId } | { source: 'audio'; audio: AudioRef }

export interface SelectedAudioInfo {
  frames: number
  sampleRate: number
  channels: number
}

export const useUiStore = defineStore('ui', () => {
  const selectedPadId = ref<PadId | null>(null)
  const dragPayload = ref<DragPayload | null>(null)
  const isLoadingAudio = ref(false)
  const audioInfo = ref<SelectedAudioInfo | null>(null)
  const sidebarWidth = ref(SIDEBAR_DEFAULT_WIDTH)
  const playbackStartFrame = ref<number | null>(null)

  const selectedPad = computed<Pad | null>(() => {
    const pads = usePadsStore()
    return selectedPadId.value ? (pads.padById(selectedPadId.value) ?? null) : null
  })

  function selectPad(id: PadId): void {
    if (selectedPadId.value === id) {
      return
    }
    selectedPadId.value = id
    playbackStartFrame.value = null
    useAudioStore().pause()
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

  function endDrag(): void {
    dragPayload.value = null
  }

  return {
    selectedPadId,
    selectedPad,
    dragPayload,
    isLoadingAudio,
    audioInfo,
    sidebarWidth,
    playbackStartFrame,
    setSidebarWidth,
    setAudioInfo,
    setPlaybackStart,
    selectPad,
    startDrag,
    endDrag,
  }
})

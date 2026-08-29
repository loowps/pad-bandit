import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useSamplePlayback, type PlaybackRequest } from '@/composables/useSamplePlayback'

export const PAD_PLAYBACK = 'pad'
export const PREVIEW_PLAYBACK = 'preview'

export const useAudioStore = defineStore('audio', () => {
  const isPlaying = ref(false)
  const source = ref<string | null>(null)
  const error = ref<string | null>(null)

  const playback = useSamplePlayback(
    () => {
      isPlaying.value = false
    },
    (message) => {
      isPlaying.value = false
      error.value = message
    },
  )

  async function start(request: PlaybackRequest, sourceId: string = PAD_PLAYBACK): Promise<void> {
    error.value = null
    source.value = sourceId
    isPlaying.value = true
    try {
      await playback.play(request)
    } catch (cause) {
      isPlaying.value = false
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function stop(): Promise<void> {
    isPlaying.value = false
    try {
      await playback.stop()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function play(sourceId: string = PAD_PLAYBACK): void {
    source.value = sourceId
    isPlaying.value = true
  }

  function pause(): void {
    void stop()
  }

  function isSourcePlaying(sourceId: string): boolean {
    return isPlaying.value && source.value === sourceId
  }

  function toggle(sourceId: string = PAD_PLAYBACK): void {
    if (isSourcePlaying(sourceId)) {
      pause()
    } else {
      play(sourceId)
    }
  }

  function setVolume(volume: number): void {
    playback.setVolume(volume)
  }

  return {
    isPlaying,
    source,
    positionFrame: playback.positionFrame,
    error,
    start,
    stop,
    play,
    pause,
    toggle,
    isSourcePlaying,
    setVolume,
  }
})

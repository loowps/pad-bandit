import { computed, type ComputedRef, type MaybeRefOrGetter, toValue, watch } from 'vue'
import { useAudioStore } from '@/stores/audio'
import type { PlaybackRequest } from '@/composables/useSamplePlayback'

export interface PlaybackSource {
  isActive: ComputedRef<boolean>
  progress: ComputedRef<number | null>
  toggle: () => void
  moveTo: () => void
}

export function usePlaybackSource(
  sourceId: string,
  buildRequest: () => PlaybackRequest | null,
  totalFrames: MaybeRefOrGetter<number>,
): PlaybackSource {
  const audio = useAudioStore()

  const isActive = computed(() => audio.isPlaying && audio.source === sourceId)

  const progress = computed(() => {
    const frames = toValue(totalFrames)
    return isActive.value && frames > 0 ? audio.positionFrame / frames : null
  })

  watch(isActive, (active) => {
    if (!active) {
      return
    }
    const request = buildRequest()
    if (!request) {
      audio.pause()
      return
    }
    void audio.start(request, sourceId)
  })

  function moveTo(): void {
    if (!isActive.value) {
      audio.toggle(sourceId)
      return
    }

    const next = buildRequest()
    if (!next) {
      audio.pause()
      return
    }

    const range = audio.playingRange
    if (range && next.startFrame >= range.start && next.startFrame <= range.end) {
      void audio.seek(next.startFrame)
    } else {
      void audio.start(next, sourceId)
    }
  }

  return { isActive, progress, toggle: () => audio.toggle(sourceId), moveTo }
}

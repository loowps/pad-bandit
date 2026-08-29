import { computed, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { useAudioStore } from '@/stores/audio'
import type { PlaybackRequest } from '@/composables/useSamplePlayback'

export interface PlaybackSource {
  isActive: ComputedRef<boolean>
  progress: ComputedRef<number | null>
  toggle: () => void
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

  return { isActive, progress, toggle: () => audio.toggle(sourceId) }
}

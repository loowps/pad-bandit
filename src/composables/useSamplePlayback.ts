import { onScopeDispose, ref, shallowRef } from 'vue'
import { useRafFn } from '@vueuse/core'
import {
  onPlaybackEnded,
  onPlaybackError,
  onPlaybackPosition,
  playAudio,
  setAudioGain,
  stopAudio,
} from '@/audio'

const GAIN_DEBOUNCE_MS = 60

export interface PlaybackRequest {
  path: string
  startFrame: number
  endFrame: number
  sampleRate: number
  loop: boolean
  reverse: boolean
  volume: number
}

export function useSamplePlayback(onFinished: () => void, onError: (message: string) => void) {
  const positionFrame = ref(0)
  const request = shallowRef<PlaybackRequest | null>(null)

  let anchorFrame = 0
  let anchorAt = 0
  let gainTimer: ReturnType<typeof setTimeout> | null = null

  const tracker = useRafFn(
    () => {
      const active = request.value
      if (!active) {
        return
      }
      const elapsed = (performance.now() - anchorAt) / 1000
      const travelled = elapsed * active.sampleRate * (active.reverse ? -1 : 1)
      positionFrame.value = clampToRegion(anchorFrame + travelled, active)
    },
    { immediate: false },
  )

  function clampToRegion(frame: number, active: PlaybackRequest): number {
    const span = active.endFrame - active.startFrame
    if (span <= 0) {
      return active.startFrame
    }
    if (!active.loop) {
      return Math.min(active.endFrame, Math.max(active.startFrame, frame))
    }
    const offset = (((frame - active.startFrame) % span) + span) % span
    return active.startFrame + offset
  }

  function anchor(frame: number): void {
    anchorFrame = frame
    anchorAt = performance.now()
    positionFrame.value = frame
  }

  const listeners = Promise.all([
    onPlaybackPosition(anchor),
    onPlaybackEnded(() => {
      tracker.pause()
      const active = request.value
      request.value = null
      positionFrame.value = active?.startFrame ?? 0
      onFinished()
    }),
    onPlaybackError((message) => {
      tracker.pause()
      request.value = null
      onError(message)
    }),
  ]).catch(() => [])

  async function play(next: PlaybackRequest): Promise<void> {
    request.value = next
    anchor(next.reverse ? next.endFrame : next.startFrame)
    tracker.resume()

    await playAudio({
      path: next.path,
      startFrame: Math.round(next.startFrame),
      endFrame: Math.round(next.endFrame),
      looping: next.loop,
      reverse: next.reverse,
      gain: next.volume,
    })
  }

  async function stop(): Promise<void> {
    tracker.pause()
    request.value = null
    await stopAudio()
  }

  function setVolume(volume: number): void {
    if (gainTimer) {
      clearTimeout(gainTimer)
    }
    gainTimer = setTimeout(() => {
      gainTimer = null
      void setAudioGain(volume)
    }, GAIN_DEBOUNCE_MS)
  }

  onScopeDispose(() => {
    tracker.pause()
    if (gainTimer) {
      clearTimeout(gainTimer)
    }
    void listeners.then((stops) => stops.forEach((unlisten) => unlisten()))
  })

  return { positionFrame, play, stop, setVolume }
}

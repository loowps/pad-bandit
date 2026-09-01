import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useSamplePlayback } from '@/composables/useSamplePlayback'

const captured: { position?: (frame: number) => void } = {}

type Unlisten = () => Promise<() => void>

vi.mock('@/audio', () => ({
  playAudio: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  stopAudio: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  setAudioGain: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  onPlaybackPosition: vi.fn<(handler: (frame: number) => void) => Promise<() => void>>(
    (handler) => {
      captured.position = handler
      return Promise.resolve(() => {})
    },
  ),
  onPlaybackEnded: vi.fn<Unlisten>(() => Promise.resolve(() => {})),
  onPlaybackError: vi.fn<Unlisten>(() => Promise.resolve(() => {})),
}))

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core')
  return { ...actual, useRafFn: () => ({ resume: () => {}, pause: () => {} }) }
})

const SAMPLE_RATE = 44_100

const request = {
  path: '/samples/break.wav',
  startFrame: 0,
  endFrame: SAMPLE_RATE * 10,
  sampleRate: SAMPLE_RATE,
  loop: false,
  reverse: false,
  volume: 1,
}

let clock = 0

beforeEach(() => {
  clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function playing() {
  const scope = effectScope()
  const playback = scope.run(() =>
    useSamplePlayback(
      () => {},
      () => {},
    ),
  )!
  await playback.play(request)
  return playback
}

describe('useSamplePlayback', () => {
  it('rides through a reported position that is only slightly behind its own estimate', async () => {
    const playback = await playing()
    expect(playback.positionFrame.value).toBe(0)

    clock += 100
    captured.position?.(4410 - 200)

    expect(playback.positionFrame.value).toBe(0)
  })

  it('snaps when the reported position is nowhere near its estimate', async () => {
    const playback = await playing()

    clock += 100
    captured.position?.(30_000)

    expect(playback.positionFrame.value).toBe(30_000)
  })

  it('takes the reported position as given while nothing is playing', async () => {
    const scope = effectScope()
    const playback = scope.run(() =>
      useSamplePlayback(
        () => {},
        () => {},
      ),
    )!

    captured.position?.(1234)

    expect(playback.positionFrame.value).toBe(1234)
  })
})

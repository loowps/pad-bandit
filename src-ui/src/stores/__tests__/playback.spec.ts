import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useAudioStore } from '@/stores/audio'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn<() => Promise<() => void>>(() => Promise.resolve(() => {})),
}))

const invokeMock = vi.mocked(invoke)

function commandsSent(): string[] {
  return invokeMock.mock.calls.map(([command]) => command)
}

const request = {
  path: '/samples/kick.wav',
  startFrame: 1000,
  endFrame: 5000,
  sampleRate: 44100,
  loop: true,
  reverse: false,
  volume: 0.5,
}

beforeEach(() => {
  setActivePinia(createPinia())
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('playback', () => {
  it('plays a region as frames, never seconds', async () => {
    const audio = useAudioStore()

    await audio.start(request)

    expect(invokeMock).toHaveBeenCalledWith('audio_play', {
      request: {
        path: '/samples/kick.wav',
        startFrame: 1000,
        endFrame: 5000,
        looping: true,
        reverse: false,
        gain: 0.5,
      },
    })
    expect(audio.isPlaying).toBe(true)
  })

  it('rounds fractional region edges before they reach the backend', async () => {
    const audio = useAudioStore()

    await audio.start({ ...request, startFrame: 1000.4, endFrame: 4999.6 })

    const [, args] = invokeMock.mock.calls[0] ?? []
    expect(args).toMatchObject({ request: { startFrame: 1000, endFrame: 5000 } })
  })

  it('starts the playhead at the region end when playing in reverse', async () => {
    const audio = useAudioStore()

    await audio.start({ ...request, reverse: true })

    expect(audio.positionFrame).toBe(5000)
    expect(invokeMock).toHaveBeenCalledWith(
      'audio_play',
      expect.objectContaining({ request: expect.objectContaining({ reverse: true }) }),
    )
  })

  it('stops through the backend and clears the playing flag', async () => {
    const audio = useAudioStore()
    await audio.start(request)

    await audio.stop()

    expect(commandsSent()).toEqual(['audio_play', 'audio_stop'])
    expect(audio.isPlaying).toBe(false)
  })

  it('collapses a volume drag into a single gain command', async () => {
    vi.useFakeTimers()
    const audio = useAudioStore()

    for (const volume of [0.1, 0.2, 0.3, 0.4, 0.5]) {
      audio.setVolume(volume)
    }
    await vi.runAllTimersAsync()

    const gainCalls = invokeMock.mock.calls.filter(([command]) => command === 'audio_set_gain')
    expect(gainCalls).toHaveLength(1)
    expect(gainCalls[0]?.[1]).toEqual({ gain: 0.5 })
  })

  it('surfaces a backend failure instead of pretending to play', async () => {
    invokeMock.mockRejectedValue(new Error('no audio output device is available'))
    const audio = useAudioStore()

    await audio.start(request)

    expect(audio.isPlaying).toBe(false)
    expect(audio.error).toBe('no audio output device is available')
  })
})

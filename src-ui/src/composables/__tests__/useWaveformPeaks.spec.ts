import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useWaveformPeaks } from '@/composables/useWaveformPeaks'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn<() => Promise<() => void>>(() => Promise.resolve(() => {})),
}))

const invokeMock = vi.mocked(invoke)
const listenMock = vi.mocked(listen)

function peaksOf(columns: number) {
  return { minMax: [-1, 1], columns, frames: 88_200, channels: 2, sampleRate: 44_100, exact: false }
}

function answerWithRequestedColumns(): void {
  invokeMock.mockImplementation((_command, args) =>
    Promise.resolve(peaksOf((args as { columns: number }).columns)),
  )
}

function neverAnswer(): void {
  invokeMock.mockImplementation(() => new Promise(() => {}))
}

let scope: ReturnType<typeof effectScope> | null = null

function read(path: Ref<string | null>, columns: Ref<number>) {
  scope = effectScope()
  return scope.run(() => useWaveformPeaks(path, columns))!
}

function requestedColumns(): number[] {
  return invokeMock.mock.calls.map(([, args]) => (args as { columns: number }).columns)
}

const settle = () => vi.advanceTimersByTimeAsync(200)

beforeEach(() => {
  vi.useFakeTimers()
  invokeMock.mockReset()
})

afterEach(() => {
  scope?.stop()
  scope = null
  vi.useRealTimers()
})

describe('useWaveformPeaks', () => {
  it('waits for a measured width instead of reading at a single column', async () => {
    answerWithRequestedColumns()
    const columns = ref(0)
    const view = read(ref('/samples/kick.wav'), columns)

    await settle()

    expect(invokeMock).not.toHaveBeenCalled()
    expect(view.isLoading.value).toBe(true)

    columns.value = 1600
    await settle()

    expect(requestedColumns()).toEqual([1600])
    expect(view.peaks.value?.columns).toBe(1600)
    expect(view.isLoading.value).toBe(false)
  })

  it('keeps the drawn waveform while re-reading at a new width', async () => {
    answerWithRequestedColumns()
    const columns = ref(1600)
    const view = read(ref('/samples/kick.wav'), columns)
    await settle()

    neverAnswer()
    columns.value = 800
    await settle()

    expect(view.peaks.value?.columns).toBe(1600)
    expect(requestedColumns()).toEqual([1600, 800])
  })

  it('drops the previous waveform as soon as the file changes', async () => {
    answerWithRequestedColumns()
    const path = ref<string | null>('/samples/kick.wav')
    const view = read(path, ref(1600))
    await settle()

    neverAnswer()
    path.value = '/samples/snare.wav'
    await nextTick()

    expect(view.peaks.value).toBeNull()
    expect(view.isLoading.value).toBe(true)
  })

  it('clears everything when the selection is dropped', async () => {
    answerWithRequestedColumns()
    const path = ref<string | null>('/samples/kick.wav')
    const view = read(path, ref(1600))
    await settle()

    path.value = null
    await settle()

    expect(view.peaks.value).toBeNull()
    expect(view.isLoading.value).toBe(false)
  })

  it('stops listening even when the waveform closes before the listener is registered', async () => {
    answerWithRequestedColumns()
    const unlisten = vi.fn<() => void>()
    let register!: (stop: () => void) => void
    listenMock.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          register = resolve
        }),
    )

    read(ref('/samples/kick.wav'), ref(600))
    scope?.stop()
    scope = null

    register(unlisten)
    await settle()

    expect(unlisten).toHaveBeenCalledTimes(1)
  })
})

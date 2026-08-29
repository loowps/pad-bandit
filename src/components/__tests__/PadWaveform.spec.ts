import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { invoke } from '@tauri-apps/api/core'
import PadWaveform from '@/components/PadWaveform.vue'
import { PREVIEW_PLAYBACK, useAudioStore } from '@/stores/audio'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { diskAudio } from '@/domain/pad'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core')
  return { ...actual, useElementSize: () => ({ width: ref(800), height: ref(64) }) }
})

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn<() => Promise<() => void>>(() => Promise.resolve(() => {})),
}))

const invokeMock = vi.mocked(invoke)

const peaks = {
  minMax: [-1, 1],
  columns: 1,
  frames: 88_200,
  channels: 2,
  sampleRate: 44_100,
  exact: false,
}

beforeEach(() => {
  setActivePinia(createPinia())
  invokeMock.mockReset()
  invokeMock.mockImplementation((command) => {
    if (command === 'audio_peaks') return Promise.resolve(peaks)
    return Promise.resolve(undefined)
  })
})

async function mountWithSelectedPad() {
  const pads = usePadsStore()
  const ui = useUiStore()
  pads.assignAudio('A1', diskAudio('/samples/kick.wav'))
  pads.updateSettings('A1', { startFrame: 4410, endFrame: 44_100, loop: true, volume: 64 })
  ui.selectPad('A1')

  const wrapper = mount(PadWaveform)
  await flushPromises()
  return wrapper
}

describe('PadWaveform', () => {
  it('asks the backend for peaks of the selected pad', async () => {
    await mountWithSelectedPad()

    const call = invokeMock.mock.calls.find(([command]) => command === 'audio_peaks')
    expect(call?.[1]).toMatchObject({ path: '/samples/kick.wav' })
  })

  it('plays the frames the pad region implies, with its loop flag and volume', async () => {
    await mountWithSelectedPad()
    const audio = useAudioStore()

    audio.toggle()
    await flushPromises()

    const call = invokeMock.mock.calls.find(([command]) => command === 'audio_play')
    expect(call?.[1]).toEqual({
      request: {
        path: '/samples/kick.wav',
        startFrame: 4410,
        endFrame: 44_100,
        looping: true,
        reverse: false,
        gain: 64 / 127,
      },
    })
  })

  it('stops through the backend when playback is toggled off', async () => {
    await mountWithSelectedPad()
    const audio = useAudioStore()
    audio.toggle()
    await flushPromises()

    audio.toggle()
    await flushPromises()

    expect(invokeMock.mock.calls.map(([command]) => command)).toContain('audio_stop')
  })

  it('never plays a pad with no audio assigned', async () => {
    const ui = useUiStore()
    ui.selectPad('B3')
    mount(PadWaveform)
    await flushPromises()
    const audio = useAudioStore()

    audio.toggle()
    await flushPromises()

    expect(invokeMock.mock.calls.map(([command]) => command)).not.toContain('audio_play')
    expect(audio.isPlaying).toBe(false)
  })
})

describe('PadWaveform playback start', () => {
  it('plays from the picked start frame instead of the region start', async () => {
    await mountWithSelectedPad()
    const ui = useUiStore()
    const audio = useAudioStore()

    ui.setPlaybackStart(20_000)
    audio.toggle()
    await flushPromises()

    const call = invokeMock.mock.calls.find(([command]) => command === 'audio_play')
    expect(call?.[1]).toMatchObject({ request: { startFrame: 20_000, endFrame: 44_100 } })
  })

  it('keeps the picked start inside the region', async () => {
    await mountWithSelectedPad()
    const ui = useUiStore()
    const audio = useAudioStore()

    ui.setPlaybackStart(90_000)
    audio.toggle()
    await flushPromises()

    const call = invokeMock.mock.calls.find(([command]) => command === 'audio_play')
    expect(call?.[1]).toMatchObject({ request: { startFrame: 44_099 } })
  })

  it('forgets the picked start when another pad is selected', async () => {
    await mountWithSelectedPad()
    const ui = useUiStore()

    ui.setPlaybackStart(20_000)
    ui.selectPad('A2')

    expect(ui.playbackStartFrame).toBeNull()
  })

  it('ignores playback started by the file preview', async () => {
    await mountWithSelectedPad()
    const audio = useAudioStore()

    await audio.start(
      {
        path: '/samples/other.wav',
        startFrame: 0,
        endFrame: 100,
        sampleRate: 44_100,
        loop: false,
        reverse: false,
        volume: 1,
      },
      PREVIEW_PLAYBACK,
    )
    await flushPromises()

    const played = invokeMock.mock.calls.filter(([command]) => command === 'audio_play')
    expect(played).toHaveLength(1)
    expect(played[0]?.[1]).toMatchObject({ request: { path: '/samples/other.wav' } })
  })
})

function stubSurface(wrapper: VueWrapper): void {
  const surface = wrapper.get('.surface').element as HTMLElement
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 50 }) as unknown as DOMRect
}

function stubPointerCapture(element: Element): void {
  Object.assign(element, {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => false,
  })
}

async function drag(target: { element: Element }, fromX: number, toX: number): Promise<void> {
  const element = target.element
  stubPointerCapture(element)
  for (const [type, clientX] of [
    ['pointerdown', fromX],
    ['pointermove', toX],
    ['pointerup', toX],
  ] as const) {
    element.dispatchEvent(
      new MouseEvent(type, { clientX, bubbles: true, cancelable: true }) as unknown as PointerEvent,
    )
  }
  await flushPromises()
}

describe('PadWaveform playhead dragging', () => {
  it('drags the playback start marker without disturbing the region', async () => {
    const wrapper = await mountWithSelectedPad()
    stubSurface(wrapper)

    await drag(wrapper.get('.playhead'), 10, 30)

    const ui = useUiStore()
    expect(ui.playbackStartFrame).toBe(22_050)
    expect(usePadsStore().padById('A1')?.settings).toMatchObject({
      startFrame: 4410,
      endFrame: 44_100,
    })
  })

  it('keeps the region resize handles reachable over the marker', async () => {
    const wrapper = await mountWithSelectedPad()
    stubSurface(wrapper)

    await drag(wrapper.findAll('.handle')[1]!, 50, 30)

    const ui = useUiStore()
    expect(usePadsStore().padById('A1')?.settings.endFrame).toBe(26_460)
    expect(ui.playbackStartFrame).toBeNull()
  })

  it('scrubs the marker when the waveform outside the region is dragged', async () => {
    const wrapper = await mountWithSelectedPad()
    stubSurface(wrapper)

    await drag(wrapper.get('.surface'), 60, 40)

    expect(useUiStore().playbackStartFrame).toBe(35_280)
  })
})

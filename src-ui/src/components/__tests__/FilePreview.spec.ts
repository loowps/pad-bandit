import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { invoke } from '@tauri-apps/api/core'
import FilePreview from '@/components/FilePreview.vue'
import { useAudioStore } from '@/stores/audio'
import { useFileBrowserStore } from '@/stores/fileBrowser'

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

async function mountWithSelectedFile() {
  const browser = useFileBrowserStore()
  browser.selectFile('/samples/break.wav')
  const wrapper = mount(FilePreview)
  await flushPromises()
  return wrapper
}

function playCall() {
  return invokeMock.mock.calls.find(([command]) => command === 'audio_play')?.[1]
}

describe('FilePreview', () => {
  it('plays the selected file from its start when the transport is pressed', async () => {
    const wrapper = await mountWithSelectedFile()

    await wrapper.get('.transport').trigger('click')
    await flushPromises()

    expect(playCall()).toEqual({
      request: {
        path: '/samples/break.wav',
        startFrame: 0,
        endFrame: 88_200,
        looping: false,
        reverse: false,
        gain: 1,
      },
    })
  })

  it('plays from the picked preview start position', async () => {
    const wrapper = await mountWithSelectedFile()
    const browser = useFileBrowserStore()

    browser.setPreviewStart(44_100)
    await wrapper.get('.transport').trigger('click')
    await flushPromises()

    expect(playCall()).toMatchObject({ request: { startFrame: 44_100 } })
  })

  it('stops through the backend when the transport is pressed again', async () => {
    const wrapper = await mountWithSelectedFile()

    await wrapper.get('.transport').trigger('click')
    await flushPromises()
    await wrapper.get('.transport').trigger('click')
    await flushPromises()

    expect(invokeMock.mock.calls.map(([command]) => command)).toContain('audio_stop')
  })

  it('forgets the preview start when another file is selected', async () => {
    await mountWithSelectedFile()
    const browser = useFileBrowserStore()

    browser.setPreviewStart(44_100)
    browser.selectFile('/samples/other.wav')

    expect(browser.previewStartFrame).toBeNull()
  })

  it('leaves its position on the picked start while another source plays', async () => {
    const wrapper = await mountWithSelectedFile()
    const browser = useFileBrowserStore()
    const audio = useAudioStore()

    browser.setPreviewStart(22_050)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.track').attributes('style')).toContain('--fraction: 0.25')

    audio.play()
    await flushPromises()

    expect(wrapper.get('.track').attributes('style')).toContain('--fraction: 0.25')
  })
})

describe('FilePreview while the next file is read', () => {
  it('keeps the transport and the track in place', async () => {
    const browser = useFileBrowserStore()
    const wrapper = await mountWithSelectedFile()

    browser.selectFile('/samples/other.wav')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.track').exists()).toBe(true)
    expect(wrapper.get('.file-name').text()).toBe('other.wav')
    expect(wrapper.get('.clock').text()).toBe('reading…')
    expect(wrapper.get('.transport').attributes('disabled')).toBeDefined()

    await flushPromises()

    expect(wrapper.get('.clock').text()).toBe('0:00 / 0:02')
    expect(wrapper.get('.transport').attributes('disabled')).toBeUndefined()
  })
})

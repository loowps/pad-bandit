import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { usePlaybackShortcut } from '@/composables/usePlaybackShortcut'
import { PREVIEW_PLAYBACK, useAudioStore } from '@/stores/audio'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<() => Promise<unknown>>(() => Promise.resolve(null)),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn<() => Promise<() => void>>(() => Promise.resolve(() => {})),
}))

const Host = defineComponent({
  setup() {
    usePlaybackShortcut()
    return () => null
  },
})

let host: VueWrapper | null = null

function pressSpace(on: Element = document.body, init: KeyboardEventInit = {}): boolean {
  if (on !== document.body) {
    document.body.append(on)
  }
  const event = new KeyboardEvent('keydown', {
    code: 'Space',
    key: ' ',
    bubbles: true,
    cancelable: true,
    ...init,
  })
  on.dispatchEvent(event)
  return event.defaultPrevented
}

describe('the space bar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    host = mount(Host)
  })

  afterEach(() => {
    host?.unmount()
    document.body.replaceChildren()
  })

  it('plays the selected pad, and pauses it again', () => {
    const audio = useAudioStore()

    expect(pressSpace()).toBe(true)
    expect(audio.isSourcePlaying('pad')).toBe(true)

    pressSpace()
    expect(audio.isPlaying).toBe(false)
  })

  it('stays with whatever played last', () => {
    const audio = useAudioStore()
    audio.play(PREVIEW_PLAYBACK)
    audio.pause()

    pressSpace()

    expect(audio.isSourcePlaying(PREVIEW_PLAYBACK)).toBe(true)
  })

  it('types a space in a text field and ticks a checkbox instead', () => {
    const audio = useAudioStore()
    const search = document.createElement('input')
    search.type = 'search'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'

    expect(pressSpace(search)).toBe(false)
    expect(pressSpace(checkbox)).toBe(false)
    expect(audio.isPlaying).toBe(false)
  })

  it('ignores a held key and a space pressed with a modifier', () => {
    const audio = useAudioStore()

    pressSpace(document.body, { repeat: true })
    pressSpace(document.body, { ctrlKey: true })

    expect(audio.isPlaying).toBe(false)
  })
})

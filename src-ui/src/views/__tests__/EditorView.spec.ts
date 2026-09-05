import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import EditorView from '@/views/EditorView.vue'
import { useSyncStore } from '@/stores/sync'
import { PAD_COUNT } from '@/domain/pad'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve(null)),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn<(event: string, handler: unknown) => Promise<() => void>>(() =>
    Promise.resolve(() => {}),
  ),
}))

describe('EditorView', () => {
  it('renders every pad of the card', () => {
    const wrapper = mount(EditorView, { global: { plugins: [createPinia()] } })

    expect(wrapper.findAll('.pad')).toHaveLength(PAD_COUNT)
    expect(wrapper.text()).toContain('Bank A')
    expect(wrapper.text()).toContain('Bank J')
  })

  it('takes the editor out of reach while a dialog is over it', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(EditorView, { global: { plugins: [pinia] } })
    const editor = wrapper.get('.editor')

    expect(editor.attributes('inert')).toBeUndefined()

    useSyncStore().isOpen = true
    await nextTick()
    await nextTick()

    expect(wrapper.get('.editor').attributes('inert')).toBeDefined()
  })

  it('composes the editor surfaces around the pad grid', () => {
    const wrapper = mount(EditorView, { global: { plugins: [createPinia()] } })

    expect(wrapper.find('.toolbar').exists()).toBe(true)
    expect(wrapper.find('.file-browser').exists()).toBe(true)
    expect(wrapper.find('.waveform').exists()).toBe(true)
    expect(wrapper.find('.parameters').exists()).toBe(true)
  })
})

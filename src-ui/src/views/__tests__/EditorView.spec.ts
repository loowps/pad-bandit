import { describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import EditorView from '@/views/EditorView.vue'
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

  it('composes the editor surfaces around the pad grid', () => {
    const wrapper = mount(EditorView, { global: { plugins: [createPinia()] } })

    expect(wrapper.find('.toolbar').exists()).toBe(true)
    expect(wrapper.find('.file-browser').exists()).toBe(true)
    expect(wrapper.find('.waveform').exists()).toBe(true)
    expect(wrapper.find('.parameters').exists()).toBe(true)
  })
})

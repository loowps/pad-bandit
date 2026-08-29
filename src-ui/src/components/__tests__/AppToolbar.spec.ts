import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import AppToolbar from '@/components/AppToolbar.vue'
import { useAudioStore } from '@/stores/audio'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { diskAudio } from '@/domain/pad'

describe('AppToolbar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows a placeholder while nothing is selected', () => {
    const wrapper = mount(AppToolbar)

    expect(wrapper.get('.pad-name').text()).toBe('—')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })

  it('names the audio source of the selected pad', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A3', diskAudio(String.raw`D:\samples\break.wav`))
    ui.selectPad('A3')
    const wrapper = mount(AppToolbar)
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.pad-name').text()).toBe('A3')
    expect(wrapper.get('.source-name').text()).toBe('break.wav')
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })

  it('toggles playback for a pad that has audio', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    const audio = useAudioStore()
    pads.assignAudio('A3', diskAudio('break.wav'))
    ui.selectPad('A3')
    const wrapper = mount(AppToolbar)

    await wrapper.get('button').trigger('click')
    expect(audio.isPlaying).toBe(true)

    await wrapper.get('button').trigger('click')
    expect(audio.isPlaying).toBe(false)
  })

  it('reverts the selected pad to what the card holds', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A3', diskAudio('break.wav'))
    pads.adoptSnapshot()
    ui.selectPad('A3')
    const wrapper = mount(AppToolbar)

    expect(wrapper.get('.revert-pad').attributes('disabled')).toBeDefined()

    pads.updateSettings('A3', { volume: 40 })
    await wrapper.vm.$nextTick()
    await wrapper.get('.revert-pad').trigger('click')

    expect(pads.padById('A3')?.settings.volume).toBe(127)
    expect(pads.isPrepared('A3')).toBe(false)
  })
})

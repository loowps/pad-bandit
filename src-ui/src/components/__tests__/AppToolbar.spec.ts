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

    expect(wrapper.get('.source-name').text()).toBe('No pad selected')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.sync-state').exists()).toBe(false)
  })

  it('names the audio source of the selected pad and where it sits', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A3', diskAudio(String.raw`D:\samples\breaks\break.wav`))
    ui.selectPad('A3')
    const wrapper = mount(AppToolbar)
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.source-name').text()).toBe('break.wav')
    expect(wrapper.get('.details').text()).toContain('Pad A3')
    expect(wrapper.get('.details').text()).toContain('samples / breaks')
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })

  it('spells out the sample format once the audio has been read', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A3', diskAudio('/samples/break.wav'))
    ui.selectPad('A3')
    ui.setAudioInfo({ frames: 88_200, sampleRate: 44_100, channels: 2 })
    const wrapper = mount(AppToolbar)
    await wrapper.vm.$nextTick()

    const details = wrapper.get('.details').text()
    expect(details).toContain('44.1 kHz')
    expect(details).toContain('stereo')
    expect(details).toContain('0:02')
  })

  it('keeps calling a cleared pad unsynced until the card catches up', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A3', diskAudio('break.wav'))
    pads.adoptSnapshot()
    ui.selectPad('A3')
    const wrapper = mount(AppToolbar)

    pads.clearPad('A3')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.sync-state').text()).toBe('Unsynced')
  })

  it('says nothing about a pad that was empty on the card too', async () => {
    const ui = useUiStore()
    ui.selectPad('A4')
    const wrapper = mount(AppToolbar)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.sync-state').exists()).toBe(false)
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

  it('says whether the selected pad still matches the card', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A3', diskAudio('break.wav'))
    pads.adoptSnapshot()
    ui.selectPad('A3')
    const wrapper = mount(AppToolbar)
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.sync-state').text()).toBe('Synced')

    pads.updateSettings('A3', { volume: 40 })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.sync-state').text()).toBe('Unsynced')
  })
})

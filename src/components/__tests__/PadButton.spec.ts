import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import PadButton from '@/components/PadButton.vue'
import { usePadsStore } from '@/stores/pads'
import { diskAudio, type Pad } from '@/domain/pad'

function padFor(id: string): Pad {
  const pad = usePadsStore().padById(id)
  if (!pad) {
    throw new Error(`no pad ${id}`)
  }
  return pad
}

describe('PadButton', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('clears the pad on Delete', async () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.updateSettings('A1', { volume: 3 })
    const wrapper = mount(PadButton, { props: { pad: padFor('A1') } })

    await wrapper.get('button').trigger('keydown', { key: 'Delete' })

    expect(pads.padById('A1')?.audio).toBeNull()
    expect(pads.padById('A1')?.settings.volume).toBe(127)
  })

  it('clears the pad on Backspace', async () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    const wrapper = mount(PadButton, { props: { pad: padFor('A1') } })

    await wrapper.get('button').trigger('keydown', { key: 'Backspace' })

    expect(pads.padById('A1')?.audio).toBeNull()
  })

  it('leaves the pad alone on other keys', async () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    const wrapper = mount(PadButton, { props: { pad: padFor('A1') } })

    await wrapper.get('button').trigger('keydown', { key: 'a' })
    await wrapper.get('button').trigger('keydown', { key: 'Enter' })

    expect(pads.padById('A1')?.audio).not.toBeNull()
  })

  it('marks a cleared pad as pending sync', async () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.adoptSnapshot()
    const wrapper = mount(PadButton, { props: { pad: padFor('A1') } })

    await wrapper.get('button').trigger('keydown', { key: 'Delete' })

    expect(pads.isPrepared('A1')).toBe(true)
    expect(pads.preparedPadIds).toEqual(['A1'])
  })

  it('says what kind of change a pad is carrying', async () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.adoptSnapshot()
    const wrapper = mount(PadButton, { props: { pad: padFor('A1') } })

    expect(wrapper.get('button').attributes('data-change')).toBeUndefined()

    pads.assignAudio('A1', diskAudio('snare.wav'))
    await wrapper.vm.$nextTick()

    expect(wrapper.get('button').attributes('data-change')).toBe('replaced')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Pad A1, sample replaced')
  })
})

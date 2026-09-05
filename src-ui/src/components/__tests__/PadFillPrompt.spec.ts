import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import PadFillPrompt from '@/components/PadFillPrompt.vue'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { diskAudio } from '@/domain/pad'

const SOURCES = [diskAudio('one.wav'), diskAudio('two.wav')]

function askAboutA1(): void {
  const pads = usePadsStore()
  pads.assignAudio('A2', diskAudio('kick.wav'))
  useUiStore().proposeDrop('A1', 0, SOURCES)
}

describe('PadFillPrompt', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stays out of the way while nothing is waiting', () => {
    const wrapper = mount(PadFillPrompt)

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('counts the pads that are in the way', async () => {
    const wrapper = mount(PadFillPrompt)

    askAboutA1()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.headline').text()).toBe('2 files from A1 — 1 pad already holds a sample.')
  })

  it('walks around them when told to skip', async () => {
    const pads = usePadsStore()
    const wrapper = mount(PadFillPrompt)
    askAboutA1()
    await wrapper.vm.$nextTick()

    await wrapper.get('.action').trigger('click')

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('one.wav'))
    expect(pads.padById('A2')?.audio).toEqual(diskAudio('kick.wav'))
    expect(pads.padById('A3')?.audio).toEqual(diskAudio('two.wav'))
    expect(useUiStore().pendingDrop).toBeNull()
  })

  it('lays them over the pads when told to overwrite', async () => {
    const pads = usePadsStore()
    const wrapper = mount(PadFillPrompt)
    askAboutA1()
    await wrapper.vm.$nextTick()

    await wrapper.get('.is-destructive').trigger('click')

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('one.wav'))
    expect(pads.padById('A2')?.audio).toEqual(diskAudio('two.wav'))
    expect(pads.lastFill).toEqual({ filled: 2, requested: 2, mode: 'overwrite' })
  })

  it('leaves the card alone when cancelled', async () => {
    const pads = usePadsStore()
    const wrapper = mount(PadFillPrompt)
    askAboutA1()
    await wrapper.vm.$nextTick()

    await wrapper.findAll('.action')[2]?.trigger('click')

    expect(pads.padById('A1')?.audio).toBeNull()
    expect(pads.lastFill).toBeNull()
    expect(useUiStore().pendingDrop).toBeNull()
  })

  it('shows what overwriting would take while the option is under the pointer', async () => {
    const ui = useUiStore()
    const wrapper = mount(PadFillPrompt)
    askAboutA1()
    await wrapper.vm.$nextTick()

    expect(ui.fillOrdinalById).toEqual({ A1: 1, A3: 2 })

    await wrapper.get('.is-destructive').trigger('mouseenter')

    expect(ui.fillOrdinalById).toEqual({ A1: 1, A2: 2 })
  })
})

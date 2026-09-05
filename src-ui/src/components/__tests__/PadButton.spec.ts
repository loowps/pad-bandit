import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import PadButton from '@/components/PadButton.vue'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
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

  it('is not a target for a bank being dragged', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    const wrapper = mount(PadButton, { props: { pad: padFor('A1') } })

    ui.startDrag({ source: 'bank', bank: 'B' })
    await wrapper.get('button').trigger('drop')

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('kick.wav'))
    expect(ui.selectedPadId).toBeNull()
    expect(ui.dragPayload).toBeNull()
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

describe('PadButton with several files', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('replaces the pad under a single dragged file', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    const wrapper = mount(PadButton, { props: { pad: padFor('A1') } })

    ui.startDrag({ source: 'audio', audio: [diskAudio('snare.wav')] })
    await wrapper.get('button').trigger('drop')

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('snare.wav'))
    expect(ui.selectedPadId).toBe('A1')
  })

  it('fills the free pads from the drop onwards without asking', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    const wrapper = mount(PadButton, { props: { pad: padFor('A1') } })

    ui.startDrag({
      source: 'audio',
      audio: [diskAudio('one.wav'), diskAudio('two.wav')],
    })
    await wrapper.get('button').trigger('drop')

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('one.wav'))
    expect(pads.padById('A2')?.audio).toEqual(diskAudio('two.wav'))
    expect(ui.pendingDrop).toBeNull()
    expect(ui.selectedPadId).toBe('A1')
  })

  it('touches nothing until the pads in the way are answered for', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A2', diskAudio('kick.wav'))
    const wrapper = mount(PadButton, { props: { pad: padFor('A1') } })

    ui.startDrag({ source: 'audio', audio: [diskAudio('one.wav'), diskAudio('two.wav')] })
    await wrapper.get('button').trigger('drop')

    expect(ui.pendingDrop?.inTheWay).toBe(1)
    expect(pads.padById('A1')?.audio).toBeNull()
    expect(pads.padById('A2')?.audio).toEqual(diskAudio('kick.wav'))
  })

  it('marks a pad the prompt offers to overwrite', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('A2', diskAudio('kick.wav'))
    const wrapper = mount(PadButton, { props: { pad: padFor('A2') } })

    ui.proposeDrop('A1', 0, [diskAudio('one.wav'), diskAudio('two.wav')])
    ui.previewDrop('overwrite')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('button').attributes('data-fill')).toBe('overwrite')
    expect(wrapper.get('.fill-ordinal').text()).toBe('2')
  })

  it('shows which track it would take while the drag is over another pad', async () => {
    const ui = useUiStore()
    const wrapper = mount(PadButton, { props: { pad: padFor('A2') } })

    ui.startDrag({ source: 'audio', audio: [diskAudio('one.wav'), diskAudio('two.wav')] })
    ui.dragOverPad('A1')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('button').attributes('data-fill')).toBe('target')
    expect(wrapper.get('.fill-ordinal').text()).toBe('2')
  })

  it('drops the preview once the drag is over', async () => {
    const ui = useUiStore()
    const wrapper = mount(PadButton, { props: { pad: padFor('A2') } })

    ui.startDrag({ source: 'audio', audio: [diskAudio('one.wav'), diskAudio('two.wav')] })
    ui.dragOverPad('A1')
    await wrapper.vm.$nextTick()
    ui.endDrag()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.fill-ordinal').exists()).toBe(false)
  })
})

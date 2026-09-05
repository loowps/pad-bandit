import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import PadBank from '@/components/PadBank.vue'
import { type Bank, usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { diskAudio } from '@/domain/pad'

function bankFor(name: string): Bank {
  const bank = usePadsStore().banks.find((candidate) => candidate.name === name)
  if (!bank) {
    throw new Error(`no bank ${name}`)
  }
  return bank
}

describe('PadBank', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('swaps with the bank dragged onto its header', async () => {
    const pads = usePadsStore()
    const ui = useUiStore()
    pads.assignAudio('B1', diskAudio('snare.wav'))
    const wrapper = mount(PadBank, { props: { bank: bankFor('A') } })

    ui.startDrag({ source: 'bank', bank: 'B' })
    await wrapper.get('header').trigger('drop')

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('snare.wav'))
    expect(pads.padById('B1')?.audio).toBeNull()
    expect(ui.dragPayload).toBeNull()
  })

  it('takes the selected pad along to the bank its sample landed in', async () => {
    const ui = useUiStore()
    ui.selectPad('A3')
    const wrapper = mount(PadBank, { props: { bank: bankFor('A') } })

    ui.startDrag({ source: 'bank', bank: 'B' })
    await wrapper.get('header').trigger('drop')

    expect(ui.selectedPadId).toBe('B3')
  })

  it('leaves a selection in an untouched bank alone', async () => {
    const ui = useUiStore()
    ui.selectPad('D3')
    const wrapper = mount(PadBank, { props: { bank: bankFor('A') } })

    ui.startDrag({ source: 'bank', bank: 'B' })
    await wrapper.get('header').trigger('drop')

    expect(ui.selectedPadId).toBe('D3')
  })

  it('offers its own name when its header is dragged', async () => {
    const ui = useUiStore()
    const wrapper = mount(PadBank, { props: { bank: bankFor('C') } })

    await wrapper.get('header').trigger('dragstart')

    expect(ui.dragPayload).toEqual({ source: 'bank', bank: 'C' })
  })
})

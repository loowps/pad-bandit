import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import PadParameters from '@/components/PadParameters.vue'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'

describe('PadParameters', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('is disabled while no pad is selected', () => {
    const wrapper = mount(PadParameters)

    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
  })

  it('enables once a pad is selected', async () => {
    const ui = useUiStore()
    const wrapper = mount(PadParameters)

    ui.selectPad('A1')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
  })

  it('writes toggles to the selected pad only', async () => {
    const ui = useUiStore()
    const pads = usePadsStore()
    ui.selectPad('B2')
    const wrapper = mount(PadParameters)

    await wrapper.get('input[type="checkbox"]').setValue(true)

    expect(pads.padById('B2')?.settings.lofi).toBe(true)
    expect(pads.padById('A1')?.settings.lofi).toBe(false)
  })

  it('reflects the settings of whichever pad is selected', async () => {
    const ui = useUiStore()
    const pads = usePadsStore()
    pads.updateSettings('A1', { volume: 12 })
    pads.updateSettings('A2', { volume: 99 })
    const wrapper = mount(PadParameters)

    ui.selectPad('A1')
    await wrapper.vm.$nextTick()
    const volumeValue = () =>
      (wrapper.findAll('input[type="number"]')[1]?.element as HTMLInputElement | undefined)?.value
    expect(volumeValue()).toBe('12')

    ui.selectPad('A2')
    await wrapper.vm.$nextTick()
    expect(volumeValue()).toBe('99')
  })
})

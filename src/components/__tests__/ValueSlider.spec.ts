import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ValueSlider from '@/components/ValueSlider.vue'

function mountSlider(value: number) {
  return mount(ValueSlider, {
    props: {
      label: 'Volume',
      min: 0,
      max: 127,
      modelValue: value,
      'onUpdate:modelValue': (updated: number) => wrapper.setProps({ modelValue: updated }),
    },
  })
}

let wrapper: ReturnType<typeof mountSlider>

describe('ValueSlider', () => {
  it('emits the dragged range value', async () => {
    wrapper = mountSlider(64)

    await wrapper.get('input[type="range"]').setValue('100')

    expect(wrapper.props('modelValue')).toBe(100)
  })

  it('accepts typed values that are within range', async () => {
    wrapper = mountSlider(64)

    await wrapper.get('input[type="number"]').setValue('100')

    expect(wrapper.props('modelValue')).toBe(100)
  })

  it('leaves the value alone while a typed number is still out of range', async () => {
    wrapper = mountSlider(64)
    const field = wrapper.get('input[type="number"]')

    ;(field.element as HTMLInputElement).value = '999'
    await field.trigger('input')

    expect(wrapper.props('modelValue')).toBe(64)
  })

  it('clamps and rewrites the field once the edit is committed', async () => {
    wrapper = mountSlider(64)
    const field = wrapper.get('input[type="number"]')

    await field.setValue('999')
    await field.trigger('change')

    expect(wrapper.props('modelValue')).toBe(127)
    expect((field.element as HTMLInputElement).value).toBe('127')

    await field.setValue('-5')
    await field.trigger('change')

    expect(wrapper.props('modelValue')).toBe(0)
    expect((field.element as HTMLInputElement).value).toBe('0')
  })

  it('restores the last value when an emptied field is committed', async () => {
    wrapper = mountSlider(64)
    const field = wrapper.get('input[type="number"]')

    await field.setValue('')
    await field.trigger('change')

    expect(wrapper.props('modelValue')).toBe(64)
    expect((field.element as HTMLInputElement).value).toBe('64')
  })

  it('disables both inputs when disabled', () => {
    wrapper = mount(ValueSlider, {
      props: { label: 'Volume', min: 0, max: 127, modelValue: 64, disabled: true },
    })

    expect(wrapper.get('input[type="range"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[type="number"]').attributes('disabled')).toBeDefined()
  })
})

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import NumberField from '@/components/NumberField.vue'

function mountField(value: number) {
  return mount(NumberField, {
    props: {
      label: 'Volume',
      min: 0,
      max: 127,
      modelValue: value,
      'onUpdate:modelValue': (updated: number) => wrapper.setProps({ modelValue: updated }),
    },
  })
}

let wrapper: ReturnType<typeof mountField>

describe('NumberField', () => {
  it('accepts typed values that are within range', async () => {
    wrapper = mountField(64)

    await wrapper.get('input').setValue('100')

    expect(wrapper.props('modelValue')).toBe(100)
  })

  it('leaves the value alone while a typed number is still out of range', async () => {
    wrapper = mountField(64)
    const field = wrapper.get('input')

    ;(field.element as HTMLInputElement).value = '999'
    await field.trigger('input')

    expect(wrapper.props('modelValue')).toBe(64)
  })

  it('clamps and rewrites the field once the edit is committed', async () => {
    wrapper = mountField(64)
    const field = wrapper.get('input')

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
    wrapper = mountField(64)
    const field = wrapper.get('input')

    await field.setValue('')
    await field.trigger('change')

    expect(wrapper.props('modelValue')).toBe(64)
    expect((field.element as HTMLInputElement).value).toBe('64')
  })

  it('shows a unit next to the value when one is given', () => {
    const tempo = mount(NumberField, {
      props: { label: 'Tempo', min: 40, max: 200, modelValue: 120, suffix: 'bpm' },
    })

    expect(tempo.get('.field-suffix').text()).toBe('bpm')
  })

  it('disables the input when disabled', () => {
    const disabled = mount(NumberField, {
      props: { label: 'Volume', min: 0, max: 127, modelValue: 64, disabled: true },
    })

    expect(disabled.get('input').attributes('disabled')).toBeDefined()
  })
})

async function drag(
  wrapper: ReturnType<typeof mountField>,
  fromY: number,
  toY: number,
  shiftKey = false,
) {
  const element = wrapper.get('input').element as HTMLInputElement & {
    setPointerCapture: (id: number) => void
    hasPointerCapture: (id: number) => boolean
  }
  element.setPointerCapture = () => {}
  element.hasPointerCapture = () => false

  const pointer = (type: string, clientY: number) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, clientY, pointerId: 1, shiftKey })

  element.dispatchEvent(pointer('pointerdown', fromY))
  element.dispatchEvent(pointer('pointermove', toY))
  element.dispatchEvent(pointer('pointerup', toY))
  await wrapper.vm.$nextTick()
}

describe('NumberField dragging', () => {
  it('raises the value when dragged up and lowers it when dragged down', async () => {
    wrapper = mountField(64)

    await drag(wrapper, 200, 100)
    expect(wrapper.props('modelValue')).toBe(106)

    await drag(wrapper, 100, 200)
    expect(wrapper.props('modelValue')).toBe(64)
  })

  it('drags in finer increments while shift is held', async () => {
    wrapper = mountField(64)

    await drag(wrapper, 200, 100, true)

    expect(wrapper.props('modelValue')).toBe(72)
  })

  it('stays inside its range however far it is dragged', async () => {
    wrapper = mountField(64)

    await drag(wrapper, 200, -4000)

    expect(wrapper.props('modelValue')).toBe(127)
  })

  it('reads the field back rather than typing into it until it is double-clicked', async () => {
    wrapper = mountField(64)
    const field = wrapper.get('input')

    expect(field.attributes('readonly')).toBeDefined()

    await field.trigger('dblclick')
    await wrapper.vm.$nextTick()

    expect(field.attributes('readonly')).toBeUndefined()

    await field.trigger('blur')

    expect(field.attributes('readonly')).toBeDefined()
  })

  it('steps the value with the arrow keys', async () => {
    wrapper = mountField(64)
    const field = wrapper.get('input')

    await field.trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.props('modelValue')).toBe(65)

    await field.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.props('modelValue')).toBe(64)
  })
})

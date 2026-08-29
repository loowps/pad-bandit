import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PaneDivider from '@/components/PaneDivider.vue'

function mountDivider(size = 240) {
  return mount(PaneDivider, {
    props: { size, min: 180, max: 480, resetTo: 240, label: 'Resize sidebar' },
    attachTo: document.body,
  })
}

function lastResize(wrapper: ReturnType<typeof mountDivider>): unknown[] | undefined {
  const events = wrapper.emitted('resize')
  return events?.[events.length - 1]
}

function pointer(type: string, clientX: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, clientX, pointerId: 1 })
}

describe('PaneDivider', () => {
  it('exposes itself as a separator with its current size', () => {
    const wrapper = mountDivider(300)
    const divider = wrapper.get('.divider')

    expect(divider.attributes('role')).toBe('separator')
    expect(divider.attributes('aria-orientation')).toBe('vertical')
    expect(divider.attributes('aria-valuenow')).toBe('300')
    expect(divider.attributes('aria-valuemin')).toBe('180')
    expect(divider.attributes('aria-valuemax')).toBe('480')
    expect(divider.attributes('tabindex')).toBe('0')
  })

  it('reports a new size while dragging', async () => {
    const wrapper = mountDivider(240)
    const element = wrapper.get('.divider').element
    element.setPointerCapture = () => {}
    element.hasPointerCapture = () => false

    element.dispatchEvent(pointer('pointerdown', 500))
    element.dispatchEvent(pointer('pointermove', 560))
    await wrapper.vm.$nextTick()

    expect(lastResize(wrapper)).toEqual([300])
  })

  it('measures every move from where the drag started', async () => {
    const wrapper = mountDivider(240)
    const element = wrapper.get('.divider').element
    element.setPointerCapture = () => {}
    element.hasPointerCapture = () => false

    element.dispatchEvent(pointer('pointerdown', 500))
    element.dispatchEvent(pointer('pointermove', 900))
    element.dispatchEvent(pointer('pointermove', 460))
    await wrapper.vm.$nextTick()

    expect(lastResize(wrapper)).toEqual([200])
  })

  it('ignores pointer movement when no drag is in progress', async () => {
    const wrapper = mountDivider(240)

    wrapper.get('.divider').element.dispatchEvent(pointer('pointermove', 900))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('resize')).toBeUndefined()
  })

  it('nudges with the arrow keys', async () => {
    const wrapper = mountDivider(240)

    await wrapper.get('.divider').trigger('keydown', { key: 'ArrowRight' })
    expect(lastResize(wrapper)).toEqual([256])

    await wrapper.get('.divider').trigger('keydown', { key: 'ArrowLeft' })
    expect(lastResize(wrapper)).toEqual([224])
  })

  it('jumps to the limits with Home and End', async () => {
    const wrapper = mountDivider(240)

    await wrapper.get('.divider').trigger('keydown', { key: 'Home' })
    expect(lastResize(wrapper)).toEqual([180])

    await wrapper.get('.divider').trigger('keydown', { key: 'End' })
    expect(lastResize(wrapper)).toEqual([480])
  })

  it('restores the default size on double click', async () => {
    const wrapper = mountDivider(400)

    await wrapper.get('.divider').trigger('dblclick')

    expect(lastResize(wrapper)).toEqual([240])
  })
})

import { describe, expect, it } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { aDialogIsOpen, useDialog } from '@/composables/useDialog'

const Host = defineComponent({
  setup() {
    const isOpen = ref(false)
    const surface = ref<HTMLElement | null>(null)

    useDialog(surface, () => {
      isOpen.value = false
    })

    return { isOpen, surface }
  },
  template: `
    <div>
      <button class="opener" @click="isOpen = true">Open</button>
      <section v-if="isOpen" ref="surface" role="dialog">
        <button class="first">First</button>
        <button class="last">Last</button>
      </section>
    </div>
  `,
})

function press(key: string, shiftKey = false): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, cancelable: true }))
}

describe('a dialog that is open', () => {
  it('puts focus on its first control', async () => {
    const wrapper = mount(Host, { attachTo: document.body })

    await wrapper.get('.opener').trigger('click')
    await nextTick()

    expect(document.activeElement).toBe(wrapper.get('.first').element)

    wrapper.unmount()
  })

  it('gives focus back to whatever opened it', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const opener = wrapper.get('.opener').element as HTMLButtonElement
    opener.focus()

    await wrapper.get('.opener').trigger('click')
    await nextTick()
    press('Escape')
    await nextTick()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(opener)

    wrapper.unmount()
  })

  it('keeps Tab from walking out of the back', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    await wrapper.get('.opener').trigger('click')
    await nextTick()
    ;(wrapper.get('.last').element as HTMLButtonElement).focus()

    press('Tab')

    expect(document.activeElement).toBe(wrapper.get('.first').element)

    wrapper.unmount()
  })

  it('keeps Shift+Tab from walking out of the front', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    await wrapper.get('.opener').trigger('click')
    await nextTick()

    press('Tab', true)

    expect(document.activeElement).toBe(wrapper.get('.last').element)

    wrapper.unmount()
  })

  it('lets the app behind it know one is open, and when none is', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    expect(aDialogIsOpen.value).toBe(false)

    await wrapper.get('.opener').trigger('click')
    await nextTick()

    expect(aDialogIsOpen.value).toBe(true)

    press('Escape')
    await nextTick()

    expect(aDialogIsOpen.value).toBe(false)

    wrapper.unmount()
  })

  it('forgets a dialog that is torn down while still open', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    await wrapper.get('.opener').trigger('click')
    await nextTick()

    wrapper.unmount()

    expect(aDialogIsOpen.value).toBe(false)
  })

  it('gives Escape to the newest dialog only', async () => {
    const under = mount(Host, { attachTo: document.body })
    const over = mount(Host, { attachTo: document.body })

    await under.get('.opener').trigger('click')
    await nextTick()
    await over.get('.opener').trigger('click')
    await nextTick()

    press('Escape')
    await nextTick()

    expect(over.find('[role="dialog"]').exists()).toBe(false)
    expect(under.find('[role="dialog"]').exists()).toBe(true)

    press('Escape')
    await nextTick()

    expect(under.find('[role="dialog"]').exists()).toBe(false)
    expect(aDialogIsOpen.value).toBe(false)

    over.unmount()
    under.unmount()
  })

  it('leaves keys alone while it is closed', async () => {
    const wrapper = mount(Host, { attachTo: document.body })
    const opener = wrapper.get('.opener').element as HTMLButtonElement
    opener.focus()

    press('Tab')

    expect(document.activeElement).toBe(opener)

    wrapper.unmount()
  })
})

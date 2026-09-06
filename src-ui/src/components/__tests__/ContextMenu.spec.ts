import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ContextMenu from '@/components/ContextMenu.vue'
import { hideContextMenu, type MenuItem, showContextMenu } from '@/composables/useContextMenu'

let mounted: VueWrapper | null = null

function item(label: string, run = vi.fn<() => void>(), disabled = false): MenuItem {
  return { label, disabled, run }
}

function render(): VueWrapper {
  mounted = mount(ContextMenu, { attachTo: document.body })
  return mounted
}

async function open(...items: MenuItem[]): Promise<void> {
  render()
  showContextMenu(new MouseEvent('contextmenu', { clientX: 30, clientY: 50 }), items)
  await flushPromises()
}

function menuElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]')
}

function itemLabels(): (string | null)[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent)
}

describe('ContextMenu', () => {
  afterEach(() => {
    hideContextMenu()
    mounted?.unmount()
    mounted = null
  })

  it('stays closed until something opens it', () => {
    render()

    expect(menuElement()).toBeNull()
  })

  it('renders its items at the pointer and focuses the first one', async () => {
    await open(item('Show in Explorer'), item('Copy path'))

    expect(menuElement()?.style.left).toBe('30px')
    expect(menuElement()?.style.top).toBe('50px')
    expect(itemLabels()).toEqual(['Show in Explorer', 'Copy path'])
    expect(document.activeElement?.textContent).toBe('Show in Explorer')
  })

  it('runs an item and closes', async () => {
    const run = vi.fn<() => void>()
    await open(item('Copy path', run))

    document.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click()
    await flushPromises()

    expect(run).toHaveBeenCalledOnce()
    expect(menuElement()).toBeNull()
  })

  it('skips disabled items when arrowing through', async () => {
    await open(item('Show in Explorer'), item('Nope', vi.fn<() => void>(), true), item('Copy path'))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    await flushPromises()

    expect(document.activeElement?.textContent).toBe('Copy path')
  })

  it('closes on Escape', async () => {
    await open(item('Copy path'))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(menuElement()).toBeNull()
  })

  it('closes when a pointer goes down outside it', async () => {
    await open(item('Copy path'))

    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await flushPromises()

    expect(menuElement()).toBeNull()
  })
})

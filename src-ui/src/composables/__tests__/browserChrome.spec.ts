import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blockBrowserMenu, blockBrowserShortcuts } from '@/composables/browserChrome'

function input(type: string | null): HTMLInputElement {
  const field = document.createElement('input')
  if (type) {
    field.type = type
  }
  return field
}

describe('blockBrowserMenu', () => {
  function rightClick(element: Element): boolean {
    document.body.append(element)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    element.dispatchEvent(event)
    return event.defaultPrevented
  }

  beforeEach(() => {
    document.addEventListener('contextmenu', blockBrowserMenu)
  })

  afterEach(() => {
    document.removeEventListener('contextmenu', blockBrowserMenu)
    document.body.replaceChildren()
  })

  it('keeps the browser menu, with its reload and save as, out of the app', () => {
    expect(rightClick(document.createElement('div'))).toBe(true)
    expect(rightClick(input('checkbox'))).toBe(true)
  })

  it('leaves cut, copy and paste to a text field', () => {
    expect(rightClick(input('search'))).toBe(false)
    expect(rightClick(input('text'))).toBe(false)
    expect(rightClick(input('number'))).toBe(false)
    expect(rightClick(input(null))).toBe(false)
    expect(rightClick(document.createElement('textarea'))).toBe(false)
  })
})

describe('blockBrowserShortcuts', () => {
  function press(init: KeyboardEventInit): boolean {
    const event = new KeyboardEvent('keydown', { cancelable: true, ...init })
    blockBrowserShortcuts(event)
    return event.defaultPrevented
  }

  it('stops reload and print', () => {
    expect(press({ key: 'F5' })).toBe(true)
    expect(press({ key: 'r', ctrlKey: true })).toBe(true)
    expect(press({ key: 'R', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(press({ key: 'p', ctrlKey: true })).toBe(true)
  })

  it('leaves every other key alone', () => {
    expect(press({ key: 'r' })).toBe(false)
    expect(press({ key: 'c', ctrlKey: true })).toBe(false)
    expect(press({ key: 's', ctrlKey: true })).toBe(false)
  })
})

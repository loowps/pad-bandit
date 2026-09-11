import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useAboutStore } from '@/stores/about'
import { useNoticesStore } from '@/stores/notices'
import type { MenuAction } from '@/projects'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

let menuHandler: ((action: MenuAction) => void) | null = null

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn<
    (event: string, handler: (event: { payload: MenuAction }) => void) => Promise<() => void>
  >((_event, handler) => {
    menuHandler = (action) => handler({ payload: action })
    return Promise.resolve(() => {
      menuHandler = null
    })
  }),
}))

const invokeMock = vi.mocked(invoke)

describe('about store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    invokeMock.mockReset()
    menuHandler = null
  })

  it('opens from the Help menu and reads the version once', async () => {
    invokeMock.mockResolvedValue('1.2.3')
    const about = useAboutStore()
    await about.listenToMenu()

    menuHandler?.({ kind: 'about' })
    await vi.waitFor(() => expect(about.version).toBe('1.2.3'))
    about.close()
    await about.open()

    expect(about.isOpen).toBe(true)
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('plugin:app|version')
  })

  it('ignores menu actions that are not about the app', async () => {
    const about = useAboutStore()
    await about.listenToMenu()

    menuHandler?.({ kind: 'save' })

    expect(about.isOpen).toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('still opens when the version cannot be read, and says so', async () => {
    invokeMock.mockRejectedValue(new Error('no app plugin'))
    const about = useAboutStore()

    await about.open()

    expect(about.isOpen).toBe(true)
    expect(about.version).toBeNull()
    expect(useNoticesStore().entries[0]?.detail).toBe('no app plugin')
  })

  it('hands a link to the system browser', async () => {
    invokeMock.mockResolvedValue(null)
    const about = useAboutStore()

    await about.follow('https://loowps.bandcamp.com')

    expect(invokeMock).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: 'https://loowps.bandcamp.com',
    })
  })

  it('reports a link no browser would take', async () => {
    invokeMock.mockRejectedValue(new Error('no default browser'))
    const about = useAboutStore()

    await about.follow('https://loowps.bandcamp.com')

    expect(useNoticesStore().entries[0]?.title).toBe('The link could not be opened')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useThemeStore } from '@/stores/theme'
import type { AppConfig, Theme } from '@/config'
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

function config(theme: Theme): AppConfig {
  return {
    version: 1,
    browseFolders: [],
    cardPath: null,
    recentProjects: [],
    theme,
    window: { width: 1230, height: 900, x: null, y: null, maximized: false },
  }
}

describe('theme store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    invokeMock.mockReset()
    menuHandler = null
    delete document.documentElement.dataset.theme
  })

  it('marks the document with the stored mode', async () => {
    invokeMock.mockResolvedValueOnce(config('dark'))
    const theme = useThemeStore()

    await theme.restore()
    await nextTick()

    expect(theme.resolved).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('persists the mode the View menu asks for', async () => {
    invokeMock.mockResolvedValue(config('dark'))
    const theme = useThemeStore()
    await theme.listenToMenu()

    menuHandler?.({ kind: 'setTheme', theme: 'dark' })
    await nextTick()

    expect(theme.preference).toBe('dark')
    expect(invokeMock).toHaveBeenCalledWith('config_set_theme', { theme: 'dark' })
  })

  it('ignores menu actions that are not about the mode', async () => {
    const theme = useThemeStore()
    await theme.listenToMenu()

    menuHandler?.({ kind: 'save' })

    expect(invokeMock).not.toHaveBeenCalled()
    expect(theme.preference).toBe('system')
  })

  it('keeps the mode it had when the backend refuses the change', async () => {
    invokeMock.mockRejectedValueOnce(new Error('config is read-only'))
    const theme = useThemeStore()

    await theme.choose('dark')

    expect(theme.preference).toBe('system')
    expect(theme.error).toBe('config is read-only')
  })
})

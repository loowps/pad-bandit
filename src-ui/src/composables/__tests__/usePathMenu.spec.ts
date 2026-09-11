import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { hideContextMenu, openMenu } from '@/composables/useContextMenu'
import { pathMenuItems, showPathMenu } from '@/composables/usePathMenu'
import { useNoticesStore } from '@/stores/notices'

const revealInFileManager = vi.fn<(path: string) => Promise<void>>(() => Promise.resolve())

vi.mock('@/filesystem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/filesystem')>()),
  getFileSystemGateway: () => ({ revealInFileManager }),
}))

function rightClick(): MouseEvent {
  return new MouseEvent('contextmenu', { clientX: 40, clientY: 60 })
}

describe('usePathMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    revealInFileManager.mockClear()
    revealInFileManager.mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()) },
    })
  })

  afterEach(() => {
    hideContextMenu()
  })

  it('opens a menu at the pointer', () => {
    showPathMenu(rightClick(), 'D:/samples/kick.wav')

    expect(openMenu.value).toMatchObject({ x: 40, y: 60 })
    expect(openMenu.value?.items.map((item) => item.label)).toEqual([
      expect.stringMatching(/Show in|Reveal in/),
      'Copy path',
    ])
  })

  it('disables every item when nothing has a path', () => {
    expect(pathMenuItems(null).every((item) => item.disabled)).toBe(true)
    expect(pathMenuItems('kick.wav').every((item) => item.disabled)).toBe(false)
  })

  it('asks the backend to reveal the path', async () => {
    const [reveal] = pathMenuItems('D:/samples/kick.wav')

    await reveal?.run()

    expect(revealInFileManager).toHaveBeenCalledWith('D:/samples/kick.wav')
    expect(useNoticesStore().count).toBe(0)
  })

  it('reports a refusal as a notice instead of throwing', async () => {
    revealInFileManager.mockRejectedValue({ code: 'unresolvablePath', message: 'gone' })
    const [reveal] = pathMenuItems('D:/samples/kick.wav')

    await reveal?.run()
    await flushPromises()

    const notices = useNoticesStore()
    expect(notices.count).toBe(1)
    expect(notices.entries[0]).toMatchObject({
      source: 'reveal',
      title: 'kick.wav could not be shown',
      detail: 'That path could not be found.',
    })
  })

  it('copies the path and says so', async () => {
    const [, copy] = pathMenuItems('D:/samples/kick.wav')

    await copy?.run()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('D:/samples/kick.wav')
    expect(useNoticesStore().entries[0]).toMatchObject({
      source: 'clipboard',
      title: 'Path copied',
    })
  })
})

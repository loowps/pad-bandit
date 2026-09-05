import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { usePadsStore } from '@/stores/pads'
import { useNoticesStore } from '@/stores/notices'
import { useProjectsStore } from '@/stores/projects'
import { diskAudio, PAD_COUNT } from '@/domain/pad'
import type { CardSlot, CardState } from '@/card'
import type { Journal, MenuAction, Project, StoredProject } from '@/projects'

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

const SET_PATH = 'D:\\Sets\\march.padbandit'

function slot(index: number, fileName: string | null): CardSlot {
  return {
    slot: index,
    settings: {
      volume: 127,
      lofi: false,
      loop: false,
      gate: true,
      reverse: false,
      tempoMode: 'off',
      originalTempo: 119.9,
      userTempo: 119.9,
    },
    sample: fileName
      ? {
          fileName,
          path: `/media/SP-CARD/ROLAND/SP-404SX/SMPL/${fileName}`,
          fingerprint: `fp-${fileName}`,
          format: 'wave',
          channels: 2,
          frames: 1_000,
          sizeBytes: 4_512,
          startFrame: 0,
          endFrame: 1_000,
        }
      : null,
  }
}

const cardState: CardState = {
  root: '/media/SP-CARD',
  fingerprint: 'fp-card',
  slots: Array.from({ length: PAD_COUNT }, (_unused, index) =>
    slot(index, index === 0 ? 'A0000001.WAV' : null),
  ),
}

let files: Record<string, Project> = {}
let recent: string[] = []
let journalled: Journal | null = null
let picked: string | null = SET_PATH
let title = 'Pad Bandit'

function remember(path: string): void {
  recent = [path, ...recent.filter((known) => known !== path)]
}

beforeEach(() => {
  setActivePinia(createPinia())
  files = {}
  recent = []
  journalled = null
  picked = SET_PATH
  title = 'Pad Bandit'
  menuHandler = null
  invokeMock.mockReset()
  invokeMock.mockImplementation((command, args) => {
    const payload = args as {
      project?: Project
      journal?: Journal
      path?: string | null
      title?: string
    }
    switch (command) {
      case 'project_pick_to_save':
      case 'project_pick_to_open':
        return Promise.resolve(picked)
      case 'project_save': {
        const path = payload.path!
        const name = path
          .split(/[\\/]/)
          .pop()!
          .replace(/\.[^.]+$/, '')
        files[path] = { ...payload.project!, name, savedAt: 1_700_000_000_000 }
        remember(path)
        return Promise.resolve({ path, project: files[path] } satisfies StoredProject)
      }
      case 'project_open': {
        const path = payload.path!
        if (!files[path]) {
          return Promise.reject(new Error(`no project at ${path}`))
        }
        remember(path)
        return Promise.resolve({ path, project: files[path] } satisfies StoredProject)
      }
      case 'project_recent':
        return Promise.resolve(recent)
      case 'project_forget_recent':
        recent = payload.path ? recent.filter((known) => known !== payload.path) : []
        return Promise.resolve(null)
      case 'journal_write':
        journalled = payload.journal!
        return Promise.resolve(null)
      case 'journal_read':
        return Promise.resolve(journalled)
      case 'journal_clear':
        journalled = null
        return Promise.resolve(null)
      case 'window_set_title':
        title = payload.title!
        return Promise.resolve(null)
      default:
        throw new Error(`unexpected command ${command}`)
    }
  })
})

function loadedPads() {
  const pads = usePadsStore()
  pads.loadFromCard(cardState)
  return pads
}

describe('projects store', () => {
  it('saves through the native dialog and takes its name from the file', async () => {
    const pads = loadedPads()
    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    const projects = useProjectsStore()

    expect(await projects.save()).toBe(true)

    expect(projects.path).toBe(SET_PATH)
    expect(projects.name).toBe('march')
    expect(projects.savedAt).toBe(1_700_000_000_000)
    expect(files[SET_PATH]?.slots[2]).toMatchObject({
      intent: 'sample',
      audio: { kind: 'path', path: '/samples/kick.wav' },
    })
    expect(projects.recent).toEqual([SET_PATH])
  })

  it('saves straight back to the same file once it has one', async () => {
    loadedPads()
    const projects = useProjectsStore()
    await projects.save()
    invokeMock.mockClear()

    expect(await projects.save()).toBe(true)

    expect(invokeMock).not.toHaveBeenCalledWith('project_pick_to_save')
    expect(invokeMock).toHaveBeenCalledWith('project_save', {
      path: SET_PATH,
      project: expect.anything(),
    })
  })

  it('save as always asks, even when the project already has a file', async () => {
    loadedPads()
    const projects = useProjectsStore()
    await projects.save()
    picked = 'D:\\Sets\\april.padbandit'

    expect(await projects.saveAs()).toBe(true)

    expect(projects.path).toBe('D:\\Sets\\april.padbandit')
    expect(projects.name).toBe('april')
    expect(projects.recent).toEqual(['D:\\Sets\\april.padbandit', SET_PATH])
  })

  it('writes nothing when the save dialog is cancelled', async () => {
    loadedPads()
    const projects = useProjectsStore()
    picked = null

    expect(await projects.save()).toBe(false)

    expect(invokeMock).not.toHaveBeenCalledWith('project_save', expect.anything())
    expect(projects.path).toBeNull()
  })

  it('reopens a saved project onto a freshly read card', async () => {
    const pads = loadedPads()
    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    pads.updateSettings('A3', { volume: 40 })
    const projects = useProjectsStore()
    await projects.save()

    pads.discardChanges()
    expect(pads.hasPreparedPads).toBe(false)

    expect(await projects.open(SET_PATH)).toBe(true)

    expect(pads.padById('A3')?.audio).toEqual(diskAudio('/samples/kick.wav'))
    expect(pads.padById('A3')?.settings.volume).toBe(40)
    expect(pads.changeFor('A3')?.status).toBe('added')
    expect(projects.hasOrphans).toBe(false)
    expect(
      useNoticesStore().entries.find((entry) => entry.source === 'project:reopened'),
    ).toMatchObject({ severity: 'info', detail: expect.stringContaining('1 resolved') })
  })

  it('reports a project that cannot be opened instead of throwing', async () => {
    loadedPads()
    const projects = useProjectsStore()

    expect(await projects.open('D:\\Sets\\absent.padbandit')).toBe(false)

    expect(useNoticesStore().entries[0]).toMatchObject({
      severity: 'error',
      title: 'The project could not be opened',
      detail: expect.stringContaining('absent'),
    })
  })

  it('journals pending work with the file it belongs to', async () => {
    const pads = loadedPads()
    const projects = useProjectsStore()
    await projects.save()

    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    await projects.journalNow()
    expect(journalled?.path).toBe(SET_PATH)
    expect(journalled?.project.slots[2]).toMatchObject({ intent: 'sample' })

    pads.discardChanges()
    await projects.journalNow()
    expect(journalled).toBeNull()
  })

  it('journals unsaved work with no file at all', async () => {
    const pads = loadedPads()
    const projects = useProjectsStore()

    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    await projects.journalNow()

    expect(journalled?.path).toBeNull()
  })

  it('offers journalled work on the next start and restores it where it came from', async () => {
    const pads = loadedPads()
    const projects = useProjectsStore()
    await projects.save()
    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    await projects.journalNow()
    pads.discardChanges()

    expect(await projects.offerRecovery()).toBe(true)
    expect(pads.changeFor('A3')).toBeNull()

    projects.restoreRecovered()

    expect(pads.changeFor('A3')?.status).toBe('added')
    expect(projects.path).toBe(SET_PATH)
    expect(projects.savedAt).toBeNull()
    expect(projects.recoverable).toBeNull()
  })

  it('throws the journal away when the offer is declined', async () => {
    const pads = loadedPads()
    const projects = useProjectsStore()
    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    await projects.journalNow()
    pads.discardChanges()
    await projects.offerRecovery()

    await projects.discardRecovered()

    expect(journalled).toBeNull()
    expect(pads.changeFor('A3')).toBeNull()
  })

  it('offers nothing when the last session exited cleanly', async () => {
    loadedPads()
    const projects = useProjectsStore()

    expect(await projects.offerRecovery()).toBe(false)
  })

  it('says how much of the work travels to another card', () => {
    const pads = loadedPads()
    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    const projects = useProjectsStore()

    expect(projects.portability).toEqual({ fromDisk: 1, fromCard: 1 })
  })

  it('starting again drops the pending work and the file it belonged to', async () => {
    const pads = loadedPads()
    const projects = useProjectsStore()
    await projects.save()
    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))

    projects.start()

    expect(projects.path).toBeNull()
    expect(projects.name).toBeNull()
    expect(pads.hasPreparedPads).toBe(false)
  })

  it('forgetting the recent list empties it without touching the files', async () => {
    loadedPads()
    const projects = useProjectsStore()
    await projects.save()

    await projects.forgetRecent()

    expect(projects.recent).toEqual([])
    expect(files[SET_PATH]).toBeDefined()
  })

  it('the window title carries the project name and a mark while work is pending', async () => {
    const pads = loadedPads()
    const projects = useProjectsStore()
    projects.startJournal()
    expect(title).toBe('Pad Bandit')

    await projects.save()
    await Promise.resolve()
    expect(projects.title).toBe('Pad Bandit — march')

    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    expect(projects.title).toBe('Pad Bandit — march •')

    projects.stopJournal()
  })

  describe('menu actions', () => {
    it('open recent goes straight to that file without a dialog', async () => {
      loadedPads()
      const projects = useProjectsStore()
      await projects.save()
      await projects.listenToMenu()
      projects.start()
      invokeMock.mockClear()

      menuHandler!({ kind: 'openRecent', path: SET_PATH })
      await vi.waitFor(() => expect(projects.path).toBe(SET_PATH))

      expect(invokeMock).not.toHaveBeenCalledWith('project_pick_to_open')
    })

    it('open asks for a file', async () => {
      loadedPads()
      const projects = useProjectsStore()
      await projects.save()
      await projects.listenToMenu()
      projects.start()

      menuHandler!({ kind: 'open' })

      await vi.waitFor(() => expect(projects.path).toBe(SET_PATH))
      expect(invokeMock).toHaveBeenCalledWith('project_pick_to_open')
    })

    it('new clears the current project', async () => {
      const pads = loadedPads()
      const projects = useProjectsStore()
      await projects.save()
      await projects.listenToMenu()
      pads.assignAudio('A3', diskAudio('/samples/kick.wav'))

      menuHandler!({ kind: 'new' })

      expect(projects.path).toBeNull()
      expect(pads.hasPreparedPads).toBe(false)
    })

    it('save as reaches the dialog through the menu', async () => {
      loadedPads()
      const projects = useProjectsStore()
      await projects.listenToMenu()

      menuHandler!({ kind: 'saveAs' })

      await vi.waitFor(() => expect(projects.path).toBe(SET_PATH))
    })

    it('the listener is dropped when journalling stops', async () => {
      loadedPads()
      const projects = useProjectsStore()
      await projects.listenToMenu()

      projects.stopJournal()

      expect(menuHandler).toBeNull()
    })
  })
})

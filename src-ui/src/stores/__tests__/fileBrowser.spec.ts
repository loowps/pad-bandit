import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useFileBrowserStore } from '@/stores/fileBrowser'
import type { AppConfig, BrowseFolder } from '@/config'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

const invokeMock = vi.mocked(invoke)

interface DirectoryEntry {
  name: string
  path: string
  isDir: boolean
  isAudio: boolean
  size: number
}

const DECODABLE = ['wav', 'aif', 'aiff', 'mp3', 'flac', 'ogg']

function entry(path: string, isDir: boolean, ext: string | null = null): DirectoryEntry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    isDir,
    isAudio: ext !== null && DECODABLE.includes(ext),
    size: 1,
  }
}

const tree: Record<string, DirectoryEntry[]> = {
  '/samples': [
    entry('/samples/drums', true),
    entry('/samples/kick.wav', false, 'wav'),
    entry('/samples/notes.txt', false, 'txt'),
    entry('/samples/voice.m4a', false, 'm4a'),
  ],
  '/samples/drums': [entry('/samples/drums/snare.aif', false, 'aif')],
}

const folder: BrowseFolder = { id: 'f1', path: '/samples', addedAt: 1 }

function config(folders: BrowseFolder[]): AppConfig {
  return {
    version: 1,
    browseFolders: folders,
    cardPath: null,
    recentProjects: [],
    theme: 'system',
    window: { width: 1230, height: 900, x: null, y: null, maximized: false },
  }
}

function listedPaths(): string[] {
  return invokeMock.mock.calls
    .filter(([command]) => command === 'list_dir')
    .map(([, args]) => (args as { path: string }).path)
}

beforeEach(() => {
  setActivePinia(createPinia())
  invokeMock.mockReset()
  invokeMock.mockImplementation((command, args) => {
    if (command === 'pick_folder') return Promise.resolve('/samples')
    if (command === 'config_get') return Promise.resolve(config([folder]))
    if (command === 'config_add_folder') return Promise.resolve(config([folder]))
    if (command === 'config_remove_folder') return Promise.resolve(config([]))
    if (command === 'list_dir') {
      return Promise.resolve(tree[(args as { path: string }).path] ?? [])
    }
    throw new Error(`unexpected command ${command}`)
  })
})

describe('fileBrowser store', () => {
  it('adds a picked folder through the picker and the config, then expands it', async () => {
    const browser = useFileBrowserStore()

    await browser.addRoot()

    expect(invokeMock).toHaveBeenCalledWith('pick_folder')
    expect(invokeMock).toHaveBeenCalledWith('config_add_folder', { path: '/samples' })
    expect(browser.roots.map((root) => root.name)).toEqual(['samples'])
    expect(browser.isExpanded('/samples')).toBe(true)
    expect(listedPaths()).toEqual(['/samples'])
  })

  it('does not touch the config when the picker is dismissed', async () => {
    invokeMock.mockImplementation((command) => {
      if (command === 'pick_folder') return Promise.resolve(null)
      throw new Error(`unexpected command ${command}`)
    })
    const browser = useFileBrowserStore()

    await browser.addRoot()

    expect(browser.roots).toHaveLength(0)
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('restores the saved folders on startup', async () => {
    const browser = useFileBrowserStore()

    await browser.restore()

    expect(invokeMock).toHaveBeenCalledWith('config_get')
    expect(browser.roots.map((root) => root.path)).toEqual(['/samples'])
  })

  it('keeps only directories and files the backend reports as decodable audio', async () => {
    const browser = useFileBrowserStore()

    await browser.addRoot()

    expect(browser.childrenOf('/samples').map((child) => child.name)).toEqual(['drums', 'kick.wav'])
  })

  it('reads each folder only once across collapse and expand', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()

    await browser.toggleDirectory('/samples')
    await browser.toggleDirectory('/samples')

    expect(browser.isExpanded('/samples')).toBe(true)
    expect(listedPaths()).toEqual(['/samples'])
  })

  it('lazily reads a subfolder only when it is opened', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()
    expect(listedPaths()).not.toContain('/samples/drums')

    await browser.toggleDirectory('/samples/drums')

    expect(listedPaths()).toContain('/samples/drums')
    expect(browser.childrenOf('/samples/drums').map((c) => c.name)).toEqual(['snare.aif'])
  })

  it('forgets a removed folder and its cached children', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()
    browser.selectFile('/samples/kick.wav')

    await browser.removeRoot('f1')

    expect(invokeMock).toHaveBeenCalledWith('config_remove_folder', { id: 'f1' })
    expect(browser.roots).toHaveLength(0)
    expect(browser.childrenOf('/samples')).toEqual([])
    expect(browser.selectedFilePath).toBeNull()
  })

  it('surfaces a failure from the backend', async () => {
    invokeMock.mockImplementation((command) => {
      if (command === 'pick_folder') return Promise.reject(new Error('Permission denied'))
      throw new Error(`unexpected command ${command}`)
    })
    const browser = useFileBrowserStore()

    await browser.addRoot()

    expect(browser.error).toBe('Permission denied')
    expect(browser.roots).toHaveLength(0)
  })
})

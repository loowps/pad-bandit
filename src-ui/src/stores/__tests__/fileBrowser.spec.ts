import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { invoke } from '@tauri-apps/api/core'
import { useFileBrowserStore } from '@/stores/fileBrowser'
import type { AppConfig, BrowseFolder } from '@/config'
import type { SampleHit, SampleSearchResult } from '@/filesystem'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn<() => Promise<() => void>>(() => Promise.resolve(() => {})),
}))

const invokeMock = vi.mocked(invoke)

interface DirectoryEntry {
  name: string
  path: string
  isDir: boolean
  isAudio: boolean
}

const DECODABLE = ['wav', 'aif', 'aiff', 'mp3', 'flac', 'ogg']

function entry(path: string, isDir: boolean, ext: string | null = null): DirectoryEntry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    isDir,
    isAudio: ext !== null && DECODABLE.includes(ext),
  }
}

function freshTree(): Record<string, DirectoryEntry[]> {
  return {
    '/samples': [
      entry('/samples/drums', true),
      entry('/samples/kick.wav', false, 'wav'),
      entry('/samples/notes.txt', false, 'txt'),
      entry('/samples/voice.m4a', false, 'm4a'),
    ],
    '/samples/drums': [entry('/samples/drums/snare.aif', false, 'aif')],
  }
}

let tree = freshTree()
let denied = new Set<string>()

const folder: BrowseFolder = { id: 'f1', path: '/samples', addedAt: 1 }

let indexing = false
let searchResult: SampleSearchResult = { hits: [], truncated: false }

function hit(name: string, location: string): SampleHit {
  return { path: `/samples/${location}/${name}`, name, location }
}

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

function searchedQueries(): string[] {
  return invokeMock.mock.calls
    .filter(([command]) => command === 'index_search')
    .map(([, args]) => (args as { query: string }).query)
}

const SEARCH_SETTLE_MS = 250

async function settle(): Promise<void> {
  await flushPromises()
  await vi.advanceTimersByTimeAsync(SEARCH_SETTLE_MS)
  await flushPromises()
}

async function search(
  browser: ReturnType<typeof useFileBrowserStore>,
  query: string,
): Promise<void> {
  browser.setQuery(query)
  await settle()
}

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  tree = freshTree()
  denied = new Set()
  indexing = false
  searchResult = { hits: [], truncated: false }
  invokeMock.mockReset()
  invokeMock.mockImplementation((command, args) => {
    if (command === 'pick_folder') return Promise.resolve('/samples')
    if (command === 'config_get') return Promise.resolve(config([folder]))
    if (command === 'config_add_folder') return Promise.resolve(config([folder]))
    if (command === 'config_remove_folder') return Promise.resolve(config([]))
    if (command === 'index_busy') return Promise.resolve(indexing)
    if (command === 'index_refresh') return Promise.resolve(null)
    if (command === 'index_search') return Promise.resolve(searchResult)
    if (command === 'list_dir') {
      const { path } = args as { path: string }
      return denied.has(path)
        ? Promise.reject(new Error('Access is denied.'))
        : Promise.resolve(tree[path] ?? [])
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
    expect(browser.previewPath).toBeNull()
    expect(browser.selectedPaths).toEqual([])
  })

  it('keeps the tree standing when one folder cannot be read', async () => {
    denied.add('/samples/drums')
    const browser = useFileBrowserStore()
    await browser.addRoot()

    await browser.toggleDirectory('/samples/drums')

    expect(browser.failureOf('/samples/drums')).toBe('Access is denied.')
    expect(browser.isExpanded('/samples/drums')).toBe(false)
    expect(browser.error).toBeNull()
    expect(browser.visibleRows.map((row) => row.node.name)).toEqual([
      'samples',
      'drums',
      'kick.wav',
    ])
  })

  it('clears a folder failure when the retry succeeds', async () => {
    denied.add('/samples/drums')
    const browser = useFileBrowserStore()
    await browser.addRoot()
    await browser.toggleDirectory('/samples/drums')

    denied.delete('/samples/drums')
    await browser.toggleDirectory('/samples/drums')

    expect(browser.failureOf('/samples/drums')).toBeNull()
    expect(browser.childrenOf('/samples/drums').map((child) => child.name)).toEqual(['snare.aif'])
  })

  it('forgets failures under a root that is removed', async () => {
    denied.add('/samples/drums')
    const browser = useFileBrowserStore()
    await browser.addRoot()
    await browser.toggleDirectory('/samples/drums')

    await browser.removeRoot('f1')

    expect(browser.failureOf('/samples/drums')).toBeNull()
  })

  it('collapses a folder that became unreadable while the tree was open', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()
    await browser.toggleDirectory('/samples/drums')

    denied.add('/samples/drums')
    await browser.refreshIndex()

    expect(browser.failureOf('/samples/drums')).toBe('Access is denied.')
    expect(browser.isExpanded('/samples/drums')).toBe(false)
    expect(browser.childrenOf('/samples').map((child) => child.name)).toEqual(['drums', 'kick.wav'])
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

  it('shows the tree while the filter is too short to search', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()

    browser.setQuery('k')

    expect(browser.isFiltering).toBe(false)
    expect(browser.visibleRows.map((row) => row.node.name)).toEqual([
      'samples',
      'drums',
      'kick.wav',
    ])
    expect(searchedQueries()).toEqual([])
  })

  it('replaces the tree with search hits once the filter is long enough', async () => {
    searchResult = { hits: [hit('kick.wav', 'drums'), hit('kicker.aif', '')], truncated: false }
    const browser = useFileBrowserStore()
    await browser.addRoot()

    await search(browser, 'kick')

    expect(searchedQueries()).toEqual(['kick'])
    expect(browser.isFiltering).toBe(true)
    expect(browser.visibleRows.map((row) => row.node.name)).toEqual(['kick.wav', 'kicker.aif'])
    expect(browser.visibleRows.map((row) => row.location)).toEqual(['drums', ''])
    expect(browser.visibleRows.every((row) => row.depth === 0 && row.rootId === null)).toBe(true)
  })

  it('gives a search hit a draggable audio node', async () => {
    searchResult = { hits: [hit('kick.wav', 'drums')], truncated: false }
    const browser = useFileBrowserStore()
    await browser.addRoot()

    await search(browser, 'kick')

    expect(browser.visibleRows[0]?.node).toEqual({
      path: '/samples/drums/kick.wav',
      name: 'kick.wav',
      isDirectory: false,
      isAudio: true,
    })
  })

  it('restores the tree and forgets the hits when the filter is cleared', async () => {
    searchResult = { hits: [hit('kick.wav', 'drums')], truncated: false }
    const browser = useFileBrowserStore()
    await browser.addRoot()
    await search(browser, 'kick')

    browser.clearQuery()

    expect(browser.isFiltering).toBe(false)
    expect(browser.visibleRows.map((row) => row.node.name)).toEqual([
      'samples',
      'drums',
      'kick.wav',
    ])
  })

  it('keeps the expanded tree intact across a search', async () => {
    searchResult = { hits: [hit('snare.aif', 'drums')], truncated: false }
    const browser = useFileBrowserStore()
    await browser.addRoot()
    await browser.toggleDirectory('/samples/drums')

    await search(browser, 'snare')
    browser.clearQuery()

    expect(browser.isExpanded('/samples/drums')).toBe(true)
    expect(browser.visibleRows.map((row) => row.node.name)).toEqual([
      'samples',
      'drums',
      'snare.aif',
      'kick.wav',
    ])
  })

  it('reports a truncated result set', async () => {
    searchResult = { hits: [hit('kick.wav', '')], truncated: true }
    const browser = useFileBrowserStore()
    await browser.addRoot()

    await search(browser, 'kick')

    expect(browser.truncated).toBe(true)
  })

  it('ignores a slow response that a newer search has superseded', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()

    let releaseFirst: (value: SampleSearchResult) => void = () => {}
    invokeMock.mockImplementation((command, args) => {
      if (command !== 'index_search') return Promise.resolve(null)
      const { query } = args as { query: string }
      if (query === 'slow') {
        return new Promise<SampleSearchResult>((resolve) => {
          releaseFirst = resolve
        })
      }
      return Promise.resolve({ hits: [hit('fast.wav', '')], truncated: false })
    })

    browser.setQuery('slow')
    await settle()
    browser.setQuery('fast')
    await settle()
    releaseFirst({ hits: [hit('stale.wav', '')], truncated: true })
    await flushPromises()

    expect(browser.visibleRows.map((row) => row.node.name)).toEqual(['fast.wav'])
    expect(browser.truncated).toBe(false)
  })

  it('surfaces a failed search and shows no hits', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()
    invokeMock.mockImplementation((command) => {
      if (command === 'index_search') return Promise.reject(new Error('Index unavailable'))
      return Promise.resolve(null)
    })

    await search(browser, 'kick')

    expect(browser.error).toBe('Index unavailable')
    expect(browser.visibleRows).toEqual([])
  })

  it('knows when a root is still being indexed', async () => {
    indexing = true
    const browser = useFileBrowserStore()

    await browser.restore()

    expect(browser.isIndexing).toBe(true)
  })

  it('asks the backend to rebuild the index and marks itself busy', async () => {
    const browser = useFileBrowserStore()
    await browser.restore()

    await browser.refreshIndex()

    expect(invokeMock).toHaveBeenCalledWith('index_refresh')
    expect(browser.isIndexing).toBe(true)
  })

  it('does not stack rebuilds while one is already running', async () => {
    indexing = true
    const browser = useFileBrowserStore()
    await browser.restore()

    await browser.refreshIndex()

    expect(invokeMock).not.toHaveBeenCalledWith('index_refresh')
  })

  it('reports a rebuild that the backend refused and stops looking busy', async () => {
    const browser = useFileBrowserStore()
    await browser.restore()
    invokeMock.mockImplementation((command) => {
      if (command === 'index_refresh') return Promise.reject(new Error('Index locked'))
      return Promise.resolve(null)
    })

    await browser.refreshIndex()

    expect(browser.error).toBe('Index locked')
    expect(browser.isIndexing).toBe(false)
  })

  it('re-reads every open folder on a rescan, so new files appear', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()
    await browser.toggleDirectory('/samples/drums')
    expect(listedPaths()).toEqual(['/samples', '/samples/drums'])

    tree['/samples/drums'] = [
      entry('/samples/drums/snare.aif', false, 'aif'),
      entry('/samples/drums/hat.wav', false, 'wav'),
    ]
    await browser.refreshIndex()

    expect(listedPaths()).toEqual(['/samples', '/samples/drums', '/samples', '/samples/drums'])
    expect(browser.childrenOf('/samples/drums').map((child) => child.name)).toEqual([
      'snare.aif',
      'hat.wav',
    ])
  })

  it('leaves collapsed folders unread on a rescan', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()

    await browser.refreshIndex()

    expect(listedPaths()).toEqual(['/samples', '/samples'])
  })

  it('collapses a folder that vanished while rescanning', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()
    await browser.toggleDirectory('/samples/drums')

    invokeMock.mockImplementation((command, args) => {
      if (command === 'index_refresh') return Promise.resolve(null)
      if (command !== 'list_dir') return Promise.resolve(null)
      const { path } = args as { path: string }
      if (path === '/samples/drums') return Promise.reject(new Error('gone'))
      return Promise.resolve(tree[path] ?? [])
    })
    await browser.refreshIndex()

    expect(browser.isExpanded('/samples/drums')).toBe(false)
    expect(browser.childrenOf('/samples/drums')).toEqual([])
    expect(browser.visibleRows.map((row) => row.node.name)).toEqual([
      'samples',
      'drums',
      'kick.wav',
    ])
  })

  it('drops the selected file when a rescan no longer lists it', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()
    browser.selectFile('/samples/kick.wav')

    tree['/samples'] = [entry('/samples/drums', true)]
    await browser.refreshIndex()

    expect(browser.previewPath).toBeNull()
    expect(browser.selectedPaths).toEqual([])
  })

  it('keeps the selected file when a rescan still lists it', async () => {
    const browser = useFileBrowserStore()
    await browser.addRoot()
    browser.selectFile('/samples/kick.wav')

    await browser.refreshIndex()

    expect(browser.previewPath).toBe('/samples/kick.wav')
    expect(browser.selectedPaths).toEqual(['/samples/kick.wav'])
  })
})

describe('the file selection', () => {
  const SNARE = '/samples/drums/snare.aif'
  const KICK = '/samples/kick.wav'

  async function openTree(): Promise<ReturnType<typeof useFileBrowserStore>> {
    const browser = useFileBrowserStore()
    await browser.addRoot()
    await browser.toggleDirectory('/samples/drums')
    return browser
  }

  it('holds one file at a time on a plain click', async () => {
    const browser = await openTree()

    browser.selectFile(SNARE)
    browser.selectFile(KICK)

    expect(browser.selectedPaths).toEqual([KICK])
    expect(browser.previewPath).toBe(KICK)
  })

  it('adds a toggled file in the order the tree shows it', async () => {
    const browser = await openTree()

    browser.selectFile(KICK)
    browser.toggleFile(SNARE)

    expect(browser.selectedPaths).toEqual([SNARE, KICK])
    expect(browser.previewPath).toBe(SNARE)
  })

  it('drops a file that is toggled again and previews what is left', async () => {
    const browser = await openTree()

    browser.selectFile(KICK)
    browser.toggleFile(SNARE)
    browser.toggleFile(SNARE)

    expect(browser.selectedPaths).toEqual([KICK])
    expect(browser.previewPath).toBe(KICK)
  })

  it('takes the range between the preview and the shift-clicked file', async () => {
    const browser = await openTree()

    browser.selectFile(SNARE)
    browser.extendSelection(KICK)

    expect(browser.selectedPaths).toEqual([SNARE, KICK])
    expect(browser.previewPath).toBe(SNARE)
  })

  it('leaves the folders out of a range', async () => {
    const browser = await openTree()

    browser.selectFile(KICK)
    browser.extendSelection(SNARE)

    expect(browser.selectedPaths).toEqual([SNARE, KICK])
  })

  it('lets go of the files a collapsed folder took away', async () => {
    const browser = await openTree()
    browser.selectFile(SNARE)
    browser.extendSelection(KICK)

    await browser.toggleDirectory('/samples/drums')

    expect(browser.selectedPaths).toEqual([KICK])
    expect(browser.previewPath).toBe(KICK)
  })

  it('drags the whole selection from a file inside it', async () => {
    const browser = await openTree()
    browser.selectFile(SNARE)
    browser.extendSelection(KICK)

    expect(browser.dragPaths(KICK)).toEqual([SNARE, KICK])
  })

  it('drags only the file that was not part of the selection', async () => {
    const browser = await openTree()
    browser.selectFile(SNARE)

    expect(browser.dragPaths(KICK)).toEqual([KICK])
    expect(browser.selectedPaths).toEqual([KICK])
  })

  it('starts over when a search replaces the tree', async () => {
    const browser = await openTree()
    browser.selectFile(KICK)

    await search(browser, 'snare')

    expect(browser.selectedPaths).toEqual([])
    expect(browser.previewPath).toBeNull()
  })
})

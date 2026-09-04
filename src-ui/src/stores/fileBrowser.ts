import { computed, ref, shallowRef } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { defineStore } from 'pinia'
import { addBrowseFolder, type BrowseFolder, getConfig, removeBrowseFolder } from '@/config'
import {
  baseName,
  type FsNode,
  getFileSystemGateway,
  hitNode,
  isSearchable,
  onIndexChanged,
  type SampleHit,
} from '@/filesystem'

const SEARCH_DEBOUNCE_MS = 200

export interface VisibleRow {
  node: FsNode
  depth: number
  rootId: string | null
  location: string | null
}

function rootNode(folder: BrowseFolder): FsNode {
  return {
    path: folder.path,
    name: baseName(folder.path),
    isDirectory: true,
    isAudio: false,
  }
}

function browsable(children: FsNode[]): FsNode[] {
  return children.filter((child) => child.isDirectory || child.isAudio)
}

function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof Error) {
    return cause.message
  }
  return typeof cause === 'string' ? cause : fallback
}

export const useFileBrowserStore = defineStore('fileBrowser', () => {
  const folders = shallowRef<BrowseFolder[]>([])
  const childrenByPath = shallowRef<Record<string, FsNode[]>>({})
  const expandedPaths = ref(new Set<string>())
  const loadingPaths = ref(new Set<string>())
  const selectedFilePath = ref<string | null>(null)
  const previewStartFrame = ref<number | null>(null)
  const error = ref<string | null>(null)

  const query = ref('')
  const hits = shallowRef<SampleHit[]>([])
  const truncated = ref(false)
  const searching = ref(false)
  const isIndexing = ref(false)

  const roots = computed<FsNode[]>(() => folders.value.map(rootNode))

  const isFiltering = computed(() => isSearchable(query.value))

  const treeRows = computed<VisibleRow[]>(() => {
    const rows: VisibleRow[] = []

    const collect = (node: FsNode, depth: number, rootId: string | null): void => {
      rows.push({ node, depth, rootId, location: null })
      if (node.isDirectory && expandedPaths.value.has(node.path)) {
        for (const child of childrenByPath.value[node.path] ?? []) {
          collect(child, depth + 1, null)
        }
      }
    }

    for (const folder of folders.value) {
      collect(rootNode(folder), 0, folder.id)
    }
    return rows
  })

  const resultRows = computed<VisibleRow[]>(() =>
    hits.value.map((hit) => ({
      node: hitNode(hit),
      depth: 0,
      rootId: null,
      location: hit.location,
    })),
  )

  const visibleRows = computed<VisibleRow[]>(() =>
    isFiltering.value ? resultRows.value : treeRows.value,
  )

  function childrenOf(directoryPath: string): FsNode[] {
    return childrenByPath.value[directoryPath] ?? []
  }

  function isExpanded(directoryPath: string): boolean {
    return expandedPaths.value.has(directoryPath)
  }

  function isLoading(directoryPath: string): boolean {
    return loadingPaths.value.has(directoryPath)
  }

  async function loadChildren(directoryPath: string): Promise<void> {
    if (childrenByPath.value[directoryPath] || loadingPaths.value.has(directoryPath)) {
      return
    }

    loadingPaths.value.add(directoryPath)
    try {
      const children = await getFileSystemGateway().listChildren(directoryPath)
      childrenByPath.value = {
        ...childrenByPath.value,
        [directoryPath]: browsable(children),
      }
    } catch (cause) {
      error.value = messageOf(cause, 'Could not read that folder.')
    } finally {
      loadingPaths.value.delete(directoryPath)
    }
  }

  async function toggleDirectory(directoryPath: string): Promise<void> {
    if (expandedPaths.value.has(directoryPath)) {
      expandedPaths.value.delete(directoryPath)
      return
    }
    expandedPaths.value.add(directoryPath)
    await loadChildren(directoryPath)
  }

  let latestSearch = 0

  async function runSearch(): Promise<void> {
    if (!isSearchable(query.value)) {
      hits.value = []
      truncated.value = false
      searching.value = false
      return
    }

    const ticket = ++latestSearch
    searching.value = true
    try {
      const result = await getFileSystemGateway().searchSamples(query.value.trim())
      if (ticket !== latestSearch) {
        return
      }
      hits.value = result.hits
      truncated.value = result.truncated
    } catch (cause) {
      if (ticket === latestSearch) {
        hits.value = []
        truncated.value = false
        error.value = messageOf(cause, 'Could not search those folders.')
      }
    } finally {
      if (ticket === latestSearch) {
        searching.value = false
      }
    }
  }

  function setQuery(next: string): void {
    query.value = next
    if (!isSearchable(next)) {
      latestSearch += 1
      hits.value = []
      truncated.value = false
      searching.value = false
    }
  }

  function clearQuery(): void {
    setQuery('')
  }

  watchDebounced(query, () => void runSearch(), { debounce: SEARCH_DEBOUNCE_MS })

  async function readIndexState(): Promise<void> {
    try {
      isIndexing.value = await getFileSystemGateway().isIndexing()
    } catch {
      isIndexing.value = false
    }
  }

  async function reloadOpenFolders(): Promise<void> {
    const gateway = getFileSystemGateway()
    const reread: Record<string, FsNode[]> = {}
    const unreadable: string[] = []

    for (const directoryPath of expandedPaths.value) {
      try {
        reread[directoryPath] = browsable(await gateway.listChildren(directoryPath))
      } catch {
        unreadable.push(directoryPath)
      }
    }

    for (const directoryPath of unreadable) {
      expandedPaths.value.delete(directoryPath)
    }

    childrenByPath.value = reread
    if (selectedFilePath.value && !isStillListed(selectedFilePath.value, reread)) {
      selectFile(null)
    }
  }

  function isStillListed(filePath: string, listings: Record<string, FsNode[]>): boolean {
    return Object.values(listings).some((children) =>
      children.some((child) => child.path === filePath),
    )
  }

  async function refreshIndex(): Promise<void> {
    if (isIndexing.value) {
      return
    }

    error.value = null
    isIndexing.value = true
    try {
      await getFileSystemGateway().refreshIndex()
    } catch (cause) {
      isIndexing.value = false
      error.value = messageOf(cause, 'Could not rebuild the sample index.')
      return
    }

    await reloadOpenFolders()
  }

  async function restore(): Promise<void> {
    error.value = null
    try {
      folders.value = (await getConfig()).browseFolders
    } catch (cause) {
      error.value = messageOf(cause, 'Could not read the saved folders.')
    }

    await readIndexState()
    await onIndexChanged(() => {
      void readIndexState()
      void runSearch()
    })
  }

  async function addRoot(): Promise<void> {
    error.value = null
    try {
      const picked = await getFileSystemGateway().pickDirectory()
      if (!picked) {
        return
      }
      folders.value = (await addBrowseFolder(picked)).browseFolders
      await toggleDirectory(picked)
    } catch (cause) {
      error.value = messageOf(cause, 'Could not open that folder.')
    }
  }

  async function removeRoot(folderId: string): Promise<void> {
    const folder = folders.value.find((candidate) => candidate.id === folderId)
    if (!folder) {
      return
    }

    error.value = null
    try {
      folders.value = (await removeBrowseFolder(folderId)).browseFolders
    } catch (cause) {
      error.value = messageOf(cause, 'Could not remove that folder.')
      return
    }

    const remaining: Record<string, FsNode[]> = {}
    for (const [path, children] of Object.entries(childrenByPath.value)) {
      if (isUnder(path, folder.path)) {
        expandedPaths.value.delete(path)
      } else {
        remaining[path] = children
      }
    }
    childrenByPath.value = remaining
    if (selectedFilePath.value && isUnder(selectedFilePath.value, folder.path)) {
      selectedFilePath.value = null
    }
  }

  function isUnder(candidate: string, root: string): boolean {
    return (
      candidate === root || candidate.startsWith(`${root}\\`) || candidate.startsWith(`${root}/`)
    )
  }

  function selectFile(filePath: string | null): void {
    if (selectedFilePath.value === filePath) {
      return
    }
    selectedFilePath.value = filePath
    previewStartFrame.value = null
  }

  function setPreviewStart(frame: number | null): void {
    previewStartFrame.value = frame === null ? null : Math.max(0, Math.round(frame))
  }

  return {
    folders,
    roots,
    childrenByPath,
    expandedPaths,
    selectedFilePath,
    previewStartFrame,
    error,
    visibleRows,
    query,
    truncated,
    searching,
    isFiltering,
    isIndexing,
    childrenOf,
    isExpanded,
    isLoading,
    restore,
    toggleDirectory,
    addRoot,
    removeRoot,
    selectFile,
    setPreviewStart,
    setQuery,
    refreshIndex,
    clearQuery,
  }
})

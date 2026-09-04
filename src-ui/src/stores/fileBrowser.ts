import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { addBrowseFolder, type BrowseFolder, getConfig, removeBrowseFolder } from '@/config'
import { baseName, type FsNode, getFileSystemGateway } from '@/filesystem'

export interface VisibleRow {
  node: FsNode
  depth: number
  rootId: string | null
}

function rootNode(folder: BrowseFolder): FsNode {
  return {
    path: folder.path,
    name: baseName(folder.path),
    isDirectory: true,
    isAudio: false,
    size: 0,
  }
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

  const roots = computed<FsNode[]>(() => folders.value.map(rootNode))

  const visibleRows = computed<VisibleRow[]>(() => {
    const rows: VisibleRow[] = []

    const collect = (node: FsNode, depth: number, rootId: string | null): void => {
      rows.push({ node, depth, rootId })
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
        [directoryPath]: children.filter((child) => child.isDirectory || child.isAudio),
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

  async function restore(): Promise<void> {
    error.value = null
    try {
      folders.value = (await getConfig()).browseFolders
    } catch (cause) {
      error.value = messageOf(cause, 'Could not read the saved folders.')
    }
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
    childrenOf,
    isExpanded,
    isLoading,
    restore,
    toggleDirectory,
    addRoot,
    removeRoot,
    selectFile,
    setPreviewStart,
  }
})

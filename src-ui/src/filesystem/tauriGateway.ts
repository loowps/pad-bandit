import { invoke } from '@tauri-apps/api/core'
import type { FileSystemGateway, FsNode, SampleSearchResult } from '@/filesystem/types'

interface DirectoryEntry {
  name: string
  path: string
  isDir: boolean
  isAudio: boolean
}

function toNode(entry: DirectoryEntry): FsNode {
  return {
    path: entry.path,
    name: entry.name,
    isDirectory: entry.isDir,
    isAudio: entry.isAudio,
  }
}

export class TauriFileSystemGateway implements FileSystemGateway {
  async pickDirectory(): Promise<string | null> {
    return (await invoke<string | null>('pick_folder')) ?? null
  }

  async listChildren(directoryPath: string): Promise<FsNode[]> {
    const entries = await invoke<DirectoryEntry[]>('list_dir', { path: directoryPath })
    return entries.map(toNode)
  }

  async searchSamples(query: string): Promise<SampleSearchResult> {
    return await invoke<SampleSearchResult>('index_search', { query })
  }

  async isIndexing(): Promise<boolean> {
    return (await invoke<boolean>('index_busy')) ?? false
  }

  async refreshIndex(): Promise<void> {
    await invoke('index_refresh')
  }
}

import { invoke } from '@tauri-apps/api/core'
import type { FileSystemGateway, FsNode } from '@/filesystem/types'

interface DirectoryEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  ext: string | null
}

function toNode(entry: DirectoryEntry): FsNode {
  return {
    path: entry.path,
    name: entry.name,
    isDirectory: entry.isDir,
    size: entry.size,
    ext: entry.ext,
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
}

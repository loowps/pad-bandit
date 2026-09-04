import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { TauriFileSystemGateway } from '@/filesystem/tauriGateway'
import type { FileSystemGateway } from '@/filesystem/types'

const gateway: FileSystemGateway = new TauriFileSystemGateway()

export function onIndexChanged(handler: () => void): Promise<UnlistenFn> {
  return listen('index:changed', () => handler())
}

export function getFileSystemGateway(): FileSystemGateway {
  return gateway
}

export * from '@/filesystem/types'

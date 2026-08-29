import { TauriFileSystemGateway } from '@/filesystem/tauriGateway'
import type { FileSystemGateway } from '@/filesystem/types'

let gateway: FileSystemGateway = new TauriFileSystemGateway()

export function getFileSystemGateway(): FileSystemGateway {
  return gateway
}

export function setFileSystemGateway(next: FileSystemGateway): void {
  gateway = next
}

export { TauriFileSystemGateway } from '@/filesystem/tauriGateway'
export * from '@/filesystem/types'

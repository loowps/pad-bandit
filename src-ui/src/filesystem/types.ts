export interface FsNode {
  path: string
  name: string
  isDirectory: boolean
  isAudio: boolean
  size: number
}

export interface FileSystemGateway {
  pickDirectory(): Promise<string | null>
  listChildren(directoryPath: string): Promise<FsNode[]>
}

export function baseName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

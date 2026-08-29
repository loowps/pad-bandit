export interface FsNode {
  path: string
  name: string
  isDirectory: boolean
  size: number
  ext: string | null
}

export interface FileSystemGateway {
  pickDirectory(): Promise<string | null>
  listChildren(directoryPath: string): Promise<FsNode[]>
}

const AUDIO_EXTENSIONS = ['wav', 'aif', 'aiff', 'mp3', 'flac', 'ogg', 'm4a']

export function isAudioFile(node: FsNode): boolean {
  return !node.isDirectory && node.ext !== null && AUDIO_EXTENSIONS.includes(node.ext)
}

export function baseName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

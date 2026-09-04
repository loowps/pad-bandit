const MIN_QUERY_LENGTH = 2

export interface FsNode {
  path: string
  name: string
  isDirectory: boolean
  isAudio: boolean
}

export interface SampleHit {
  path: string
  name: string
  location: string
}

export interface SampleSearchResult {
  hits: SampleHit[]
  truncated: boolean
}

export interface FileSystemGateway {
  pickDirectory(): Promise<string | null>
  listChildren(directoryPath: string): Promise<FsNode[]>
  searchSamples(query: string): Promise<SampleSearchResult>
  isIndexing(): Promise<boolean>
  refreshIndex(): Promise<void>
}

export function baseName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? path
}

export function isSearchable(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH
}

export function hitNode(hit: SampleHit): FsNode {
  return {
    path: hit.path,
    name: hit.name,
    isDirectory: false,
    isAudio: true,
  }
}

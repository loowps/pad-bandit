const VERBATIM_UNC_PREFIX = '\\\\?\\UNC\\'
const VERBATIM_DISK_PREFIX = /^\\\\\?\\([A-Za-z]:\\)/

const REVEAL_LABELS = {
  windows: 'Show in Explorer',
  mac: 'Reveal in Finder',
  other: 'Show in file manager',
} as const

export function revealLabel(userAgent: string): string {
  if (/Mac OS X|Macintosh/i.test(userAgent)) {
    return REVEAL_LABELS.mac
  }
  if (/Windows/i.test(userAgent)) {
    return REVEAL_LABELS.windows
  }
  return REVEAL_LABELS.other
}

export function simplifiedPath(path: string): string {
  if (path.startsWith(VERBATIM_UNC_PREFIX)) {
    return `\\\\${path.slice(VERBATIM_UNC_PREFIX.length)}`
  }
  return path.replace(VERBATIM_DISK_PREFIX, '$1')
}

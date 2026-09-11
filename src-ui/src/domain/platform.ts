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

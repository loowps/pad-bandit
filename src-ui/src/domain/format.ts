export function clockTime(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const rest = Math.floor(safe % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function preciseTime(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`
}

export function sampleRateLabel(hertz: number): string {
  return `${(hertz / 1000).toFixed(1).replace(/\.0$/, '')} kHz`
}

export function channelsLabel(channels: number): string {
  if (channels === 1) {
    return 'mono'
  }
  return channels === 2 ? 'stereo' : `${channels} channels`
}

export function folderTrail(path: string, depth = 3): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments.slice(Math.max(0, segments.length - 1 - depth), -1).join(' / ')
}

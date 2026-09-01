export const MIN_REGION_SECONDS = 0.4

export interface Region {
  start: number
  end: number
}

export interface RegionBounds {
  totalFrames: number
  minFrames: number
}

function clampToBuffer(frame: number, totalFrames: number): number {
  return Math.min(totalFrames, Math.max(0, Math.round(frame)))
}

export function minRegionFrames(sampleRate: number): number {
  return Math.round(MIN_REGION_SECONDS * sampleRate)
}

export function setRegionStart(region: Region, start: number, bounds: RegionBounds): Region {
  const latestStart = Math.max(0, region.end - bounds.minFrames)
  return {
    start: Math.min(clampToBuffer(start, bounds.totalFrames), latestStart),
    end: region.end,
  }
}

export function setRegionEnd(region: Region, end: number, bounds: RegionBounds): Region {
  const earliestEnd = Math.min(bounds.totalFrames, region.start + bounds.minFrames)
  return {
    start: region.start,
    end: Math.max(clampToBuffer(end, bounds.totalFrames), earliestEnd),
  }
}

export function moveRegion(region: Region, deltaFrames: number, bounds: RegionBounds): Region {
  const length = region.end - region.start
  const start = clampToBuffer(region.start + deltaFrames, bounds.totalFrames - length)
  return { start, end: start + length }
}

export function fitRegionToBuffer(region: Region, bounds: RegionBounds): Region {
  const { totalFrames } = bounds
  if (totalFrames === 0) {
    return { start: 0, end: 0 }
  }

  const minFrames = Math.min(bounds.minFrames, totalFrames)
  const end = region.end > 0 ? clampToBuffer(region.end, totalFrames) : totalFrames
  const start = Math.max(0, Math.min(clampToBuffer(region.start, totalFrames), end - minFrames))

  return { start, end: Math.min(totalFrames, Math.max(end, start + minFrames)) }
}

export function clampPlaybackStart(frame: number | null, region: Region): number {
  if (frame === null) {
    return region.start
  }
  const latestStart = Math.max(region.start, region.end - 1)
  return Math.min(Math.max(Math.round(frame), region.start), latestStart)
}

export interface PlayedSpan {
  from: number
  to: number
}

export function playedSpan(
  progress: number | null,
  playedFrom: number,
  columns: number,
): PlayedSpan {
  if (progress === null || columns === 0) {
    return { from: 0, to: 0 }
  }
  const asColumn = (fraction: number) => Math.round(Math.min(1, Math.max(0, fraction)) * columns)
  const from = asColumn(playedFrom)
  return { from, to: Math.max(from, asColumn(progress)) }
}

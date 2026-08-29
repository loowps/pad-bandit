import { describe, expect, it } from 'vitest'
import {
  MIN_REGION_SECONDS,
  clampPlaybackStart,
  fitRegionToBuffer,
  minRegionFrames,
  moveRegion,
  setRegionEnd,
  setRegionStart,
} from '@/domain/region'

const bounds = { totalFrames: 1000, minFrames: 100 }

describe('minRegionFrames', () => {
  it('converts the minimum region length into frames', () => {
    expect(minRegionFrames(44100)).toBe(Math.round(MIN_REGION_SECONDS * 44100))
    expect(minRegionFrames(48000)).toBe(19200)
  })
})

describe('setRegionStart', () => {
  it('moves the start edge', () => {
    expect(setRegionStart({ start: 100, end: 900 }, 250, bounds)).toEqual({ start: 250, end: 900 })
  })

  it('never crosses the minimum length before the end', () => {
    expect(setRegionStart({ start: 100, end: 900 }, 880, bounds)).toEqual({ start: 800, end: 900 })
  })

  it('never moves before the start of the buffer', () => {
    expect(setRegionStart({ start: 100, end: 900 }, -50, bounds)).toEqual({ start: 0, end: 900 })
  })
})

describe('setRegionEnd', () => {
  it('moves the end edge', () => {
    expect(setRegionEnd({ start: 100, end: 900 }, 700, bounds)).toEqual({ start: 100, end: 700 })
  })

  it('never crosses the minimum length after the start', () => {
    expect(setRegionEnd({ start: 100, end: 900 }, 120, bounds)).toEqual({ start: 100, end: 200 })
  })

  it('never moves past the end of the buffer', () => {
    expect(setRegionEnd({ start: 100, end: 900 }, 1200, bounds)).toEqual({ start: 100, end: 1000 })
  })
})

describe('moveRegion', () => {
  it('shifts both edges and keeps the length', () => {
    expect(moveRegion({ start: 100, end: 300 }, 50, bounds)).toEqual({ start: 150, end: 350 })
  })

  it('stops at the start of the buffer without shrinking', () => {
    expect(moveRegion({ start: 100, end: 300 }, -500, bounds)).toEqual({ start: 0, end: 200 })
  })

  it('stops at the end of the buffer without shrinking', () => {
    expect(moveRegion({ start: 100, end: 300 }, 5000, bounds)).toEqual({ start: 800, end: 1000 })
  })
})

describe('fitRegionToBuffer', () => {
  it('spans the whole buffer when no end has been stored yet', () => {
    expect(fitRegionToBuffer({ start: 0, end: 0 }, bounds)).toEqual({ start: 0, end: 1000 })
  })

  it('keeps a stored region that already fits', () => {
    expect(fitRegionToBuffer({ start: 200, end: 600 }, bounds)).toEqual({ start: 200, end: 600 })
  })

  it('clamps a stored region recorded against a longer sample', () => {
    expect(fitRegionToBuffer({ start: 4000, end: 9000 }, bounds)).toEqual({ start: 900, end: 1000 })
  })

  it('collapses to nothing for an empty buffer', () => {
    expect(fitRegionToBuffer({ start: 10, end: 20 }, { totalFrames: 0, minFrames: 100 })).toEqual({
      start: 0,
      end: 0,
    })
  })

  it('uses the whole buffer when it is shorter than the minimum length', () => {
    expect(fitRegionToBuffer({ start: 0, end: 0 }, { totalFrames: 50, minFrames: 100 })).toEqual({
      start: 0,
      end: 50,
    })
  })
})

describe('clampPlaybackStart', () => {
  it('falls back to the region start when nothing was picked', () => {
    expect(clampPlaybackStart(null, { start: 1000, end: 5000 })).toBe(1000)
  })

  it('keeps a picked frame inside the region', () => {
    expect(clampPlaybackStart(400, { start: 1000, end: 5000 })).toBe(1000)
    expect(clampPlaybackStart(9000, { start: 1000, end: 5000 })).toBe(4999)
    expect(clampPlaybackStart(2500.6, { start: 1000, end: 5000 })).toBe(2501)
  })

  it('collapses to the start of an empty region', () => {
    expect(clampPlaybackStart(500, { start: 0, end: 0 })).toBe(0)
  })
})

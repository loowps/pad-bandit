import { describe, expect, it } from 'vitest'
import { padsInTheWay, planDrop } from '@/domain/fill'
import { createEmptyCard, diskAudio, type Pad, type PadId } from '@/domain/pad'

function cardWithout(free: PadId[]): Record<PadId, Pad> {
  const pads = createEmptyCard()
  for (const id of free) {
    const pad = pads[id]
    if (pad) {
      pad.audio = diskAudio(`${id}.wav`)
    }
  }
  return pads
}

describe('planDrop', () => {
  it('takes the pads from the drop onwards', () => {
    expect(planDrop(createEmptyCard(), 0, 3, 'fill')).toEqual(['A1', 'A2', 'A3'])
  })

  it('stops when the sources run out', () => {
    expect(planDrop(createEmptyCard(), 4, 1, 'fill')).toEqual(['A5'])
  })

  it('skips the pads that already hold a sample', () => {
    const pads = cardWithout(['A2', 'A3'])

    expect(planDrop(pads, 0, 3, 'fill')).toEqual(['A1', 'A4', 'A5'])
  })

  it('starts at the next free pad when the drop pad is taken', () => {
    const pads = cardWithout(['A1'])

    expect(planDrop(pads, 0, 2, 'fill')).toEqual(['A2', 'A3'])
  })

  it('flows across the bank boundary', () => {
    expect(planDrop(createEmptyCard(), 10, 3, 'fill')).toEqual(['A11', 'A12', 'B1'])
  })

  it('never runs past the last pad', () => {
    expect(planDrop(createEmptyCard(), 118, 5, 'fill')).toEqual(['J11', 'J12'])
  })

  it('finds nothing when every pad from there on is taken', () => {
    const pads = cardWithout(['J11', 'J12'])

    expect(planDrop(pads, 118, 2, 'fill')).toEqual([])
  })
})

describe('planDrop while overwriting', () => {
  it('takes the run of pads from the drop, taken or not', () => {
    const pads = cardWithout(['A2'])

    expect(planDrop(pads, 0, 3, 'overwrite')).toEqual(['A1', 'A2', 'A3'])
  })

  it('still stops at the last pad', () => {
    expect(planDrop(createEmptyCard(), 118, 5, 'overwrite')).toEqual(['J11', 'J12'])
  })
})

describe('padsInTheWay', () => {
  it('finds nothing on a run of free pads', () => {
    expect(padsInTheWay(createEmptyCard(), 0, 4)).toEqual([])
  })

  it('names the pads the run would land on', () => {
    const pads = cardWithout(['A2', 'A4'])

    expect(padsInTheWay(pads, 0, 3)).toEqual(['A2'])
  })

  it('counts the drop pad itself', () => {
    const pads = cardWithout(['A1'])

    expect(padsInTheWay(pads, 0, 1)).toEqual(['A1'])
  })

  it('looks no further than the last pad', () => {
    const pads = cardWithout(['J12'])

    expect(padsInTheWay(pads, 118, 6)).toEqual(['J12'])
  })
})

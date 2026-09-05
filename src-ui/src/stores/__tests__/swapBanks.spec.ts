import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePadsStore } from '@/stores/pads'
import { diskAudio, PAD_COUNT, PADS_PER_BANK } from '@/domain/pad'
import type { CardSlot, CardState } from '@/card'

const FILLED_BANKS = [0, 2]

function slot(index: number, fileName: string | null): CardSlot {
  return {
    slot: index,
    settings: {
      volume: 127,
      lofi: false,
      loop: false,
      gate: true,
      reverse: false,
      tempoMode: 'off',
      originalTempo: 120,
      userTempo: 120,
    },
    sample: fileName
      ? {
          fileName,
          path: `/media/SP-CARD/ROLAND/SP-404SX/SMPL/${fileName}`,
          fingerprint: `size:4512 head:${fileName} tail:${fileName}`,
          format: 'wave',
          channels: 2,
          frames: 1_000,
          sizeBytes: 4_512,
          startFrame: 0,
          endFrame: 1_000,
        }
      : null,
  }
}

const cardState: CardState = {
  root: '/media/SP-CARD',
  fingerprint: 'fp-card',
  slots: Array.from({ length: PAD_COUNT }, (_unused, index) =>
    slot(
      index,
      FILLED_BANKS.includes(Math.floor(index / PADS_PER_BANK))
        ? `S${String(index).padStart(7, '0')}.WAV`
        : null,
    ),
  ),
}

function loadedPads() {
  const pads = usePadsStore()
  pads.loadFromCard(cardState)
  return pads
}

describe('swapping banks', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('trades every pad of two filled banks and reports where each one came from', () => {
    const pads = loadedPads()

    pads.swapBanks('A', 'C')

    expect(pads.plan).toHaveLength(2 * PADS_PER_BANK)
    expect(pads.plan.every((change) => change.status === 'moved')).toBe(true)
    expect(pads.changeFor('A1')?.fromSlot).toBe(24)
    expect(pads.changeFor('A12')?.fromSlot).toBe(35)
    expect(pads.changeFor('C1')?.fromSlot).toBe(0)
    expect(pads.padById('A1')?.audio).toEqual(pads.cardPads['C1']?.audio)
  })

  it('empties the bank it moved out of when the other one is empty', () => {
    const pads = loadedPads()

    pads.swapBanks('A', 'B')

    const moved = pads.plan.filter((change) => change.status === 'moved')
    const removed = pads.plan.filter((change) => change.status === 'removed')
    expect(moved).toHaveLength(PADS_PER_BANK)
    expect(removed).toHaveLength(PADS_PER_BANK)
    expect(pads.changeFor('B1')?.fromSlot).toBe(0)
    expect(pads.padById('A1')?.audio).toBeNull()
  })

  it('carries pad settings across with the samples', () => {
    const pads = loadedPads()
    pads.updateSettings('A1', { volume: 64, reverse: true })

    pads.swapBanks('A', 'C')

    expect(pads.padById('C1')?.settings.volume).toBe(64)
    expect(pads.padById('C1')?.settings.reverse).toBe(true)
    expect(pads.padById('A1')?.settings.volume).toBe(127)
  })

  it('keeps a pad still pointing at a file on disk pointing at it', () => {
    const pads = loadedPads()
    pads.assignAudio('B1', diskAudio('/samples/kick.wav'))

    pads.swapBanks('A', 'B')

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('/samples/kick.wav'))
    expect(pads.changeFor('A1')?.status).toBe('replaced')
    expect(pads.changeFor('B1')?.status).toBe('moved')
    expect(pads.changeFor('B1')?.fromSlot).toBe(0)
  })

  it('asks the card for nothing when the same swap is made twice', () => {
    const pads = loadedPads()

    pads.swapBanks('A', 'C')
    pads.swapBanks('C', 'A')

    expect(pads.plan).toEqual([])
  })

  it('asks the card for nothing on pads that were empty on both sides', () => {
    const pads = loadedPads()

    pads.swapBanks('B', 'D')

    expect(pads.intentById['B1']).toEqual({ kind: 'keep' })
    expect(pads.intentById['D12']).toEqual({ kind: 'keep' })
    expect(pads.plan).toEqual([])
  })

  it('remembers a removal the user asked for before the swap', () => {
    const pads = loadedPads()
    pads.clearPad('A1')

    pads.swapBanks('A', 'B')

    expect(pads.intentById['A1']).toEqual({ kind: 'clear' })
    expect(pads.changeFor('A1')?.status).toBe('removed')
  })

  it('ignores a bank swapped with itself', () => {
    const pads = loadedPads()

    pads.swapBanks('A', 'A')

    expect(pads.plan).toEqual([])
  })
})

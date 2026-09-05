import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePadsStore } from '@/stores/pads'
import { diskAudio, PAD_COUNT } from '@/domain/pad'
import type { CardSlot, CardState } from '@/card'

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
      originalTempo: 119.9,
      userTempo: 119.9,
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

const filledSlots = new Map([
  [0, 'A0000001.WAV'],
  [1, 'A0000002.WAV'],
  [26, 'C0000003.WAV'],
])

const cardState: CardState = {
  root: '/media/SP-CARD',
  fingerprint: 'fp-card',
  slots: Array.from({ length: PAD_COUNT }, (_unused, index) =>
    slot(index, filledSlots.get(index) ?? null),
  ),
}

function loadedPads() {
  const pads = usePadsStore()
  pads.loadFromCard(cardState)
  return pads
}

describe('per-slot intent', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('leaves every slot on keep after a card is read', () => {
    const pads = loadedPads()

    expect(pads.plan).toEqual([])
    expect(pads.intentById['A1']).toEqual({ kind: 'keep' })
    expect(pads.intentById['B1']).toEqual({ kind: 'keep' })
  })

  it('cannot delete a sample nobody touched', () => {
    const pads = loadedPads()

    pads.updateSettings('A1', { volume: 64 })

    expect(pads.changeFor('A1')?.status).toBe('settings')
    expect(pads.plan.some((change) => change.status === 'removed')).toBe(false)
  })

  it('records a removal only from a pad the user actually cleared', () => {
    const pads = loadedPads()

    pads.clearPad('A1')

    expect(pads.changeFor('A1')).toMatchObject({
      status: 'removed',
      previousFileName: 'A0000001.WAV',
    })
    expect(pads.preparedPadIds).toEqual(['A1'])
  })

  it('reports a dropped file as added on an empty pad and replaced on a filled one', () => {
    const pads = loadedPads()

    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    pads.assignAudio('A1', diskAudio('/samples/snare.wav'))

    expect(pads.changeFor('A3')?.status).toBe('added')
    expect(pads.changeFor('A1')?.status).toBe('replaced')
  })

  it('reports a pad-to-pad drag as a move on both sides', () => {
    const pads = loadedPads()

    pads.swapPads('A1', 'A2')

    expect(pads.changeFor('A1')).toMatchObject({ status: 'moved', fromSlot: 1 })
    expect(pads.changeFor('A2')).toMatchObject({ status: 'moved', fromSlot: 0 })
  })

  it('empties the pad a sample was dragged off when the target was empty', () => {
    const pads = loadedPads()

    pads.swapPads('C3', 'B1')

    expect(pads.changeFor('B1')).toMatchObject({ status: 'moved', fromSlot: 26 })
    expect(pads.changeFor('C3')).toMatchObject({ status: 'removed' })
    expect(pads.padById('C3')?.audio).toBeNull()
    expect(pads.padById('C3')?.settings).toEqual(pads.cardPads['B1']?.settings)
  })

  it('does not leak the settings of an empty pad onto the sample it receives', () => {
    const pads = loadedPads()
    pads.updateSettings('B1', { volume: 3, reverse: true })

    pads.swapPads('C3', 'B1')

    expect(pads.padById('B1')?.settings.volume).toBe(127)
    expect(pads.padById('B1')?.settings.reverse).toBe(false)
  })

  it('takes a pad back to what the card holds', () => {
    const pads = loadedPads()
    pads.assignAudio('A1', diskAudio('/samples/kick.wav'))
    pads.updateSettings('A1', { volume: 12 })

    pads.revertPad('A1')

    expect(pads.changeFor('A1')).toBeNull()
    expect(pads.padById('A1')?.audio).toMatchObject({ kind: 'card', originSlot: 0 })
    expect(pads.padById('A1')?.sample?.fileName).toBe('A0000001.WAV')
    expect(pads.padById('A1')?.settings.volume).toBe(127)
    expect(pads.intentById['A1']).toEqual({ kind: 'keep' })
  })

  it('brings back a pad the user cleared', () => {
    const pads = loadedPads()
    pads.clearPad('A1')

    pads.revertPad('A1')

    expect(pads.padById('A1')?.sample?.fileName).toBe('A0000001.WAV')
    expect(pads.plan).toEqual([])
  })

  it('discards every pending change at once without touching the card', () => {
    const pads = loadedPads()
    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))
    pads.clearPad('A2')
    pads.updateSettings('C3', { lofi: true })

    pads.discardChanges()

    expect(pads.plan).toEqual([])
    expect(pads.hasPreparedPads).toBe(false)
    expect(pads.padById('A2')?.sample?.fileName).toBe('A0000002.WAV')
    expect(pads.padById('A3')?.audio).toBeNull()
    expect(pads.padById('C3')?.settings.lofi).toBe(false)
  })

  it('adopts the card state again once it has been written', () => {
    const pads = loadedPads()
    pads.assignAudio('A3', diskAudio('/samples/kick.wav'))

    pads.adoptSnapshot()

    expect(pads.plan).toEqual([])
    expect(pads.intentById['A3']).toEqual({ kind: 'keep' })
    expect(pads.padById('A3')?.audio).toEqual(diskAudio('/samples/kick.wav'))
  })

  it('reports changes in slot order', () => {
    const pads = loadedPads()

    pads.updateSettings('C3', { lofi: true })
    pads.clearPad('A1')
    pads.assignAudio('B1', diskAudio('/samples/kick.wav'))

    expect(pads.preparedPadIds).toEqual(['A1', 'B1', 'C3'])
  })
})

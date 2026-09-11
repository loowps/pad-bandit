import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePadsStore } from '@/stores/pads'
import { BANK_NAMES, diskAudio, PAD_COUNT, PADS_PER_BANK } from '@/domain/pad'
import type { CardState } from '@/card'

describe('pads store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('creates one pad per slot, addressed by bank and number', () => {
    const pads = usePadsStore()

    expect(pads.allPads).toHaveLength(PAD_COUNT)
    expect(pads.padById('A1')?.slot).toBe(0)
    expect(pads.padById('A12')?.slot).toBe(11)
    expect(pads.padById('J12')?.slot).toBe(PAD_COUNT - 1)
  })

  it('groups pads into banks in slot order', () => {
    const pads = usePadsStore()

    expect(pads.banks).toHaveLength(BANK_NAMES.length)
    expect(pads.banks.every((bank) => bank.pads.length === PADS_PER_BANK)).toBe(true)
    expect(pads.banks[1]?.pads[0]?.id).toBe('B1')
  })

  it('merges partial setting changes into the addressed pad only', () => {
    const pads = usePadsStore()

    pads.updateSettings('A1', { volume: 64, reverse: true })

    expect(pads.padById('A1')?.settings.volume).toBe(64)
    expect(pads.padById('A1')?.settings.reverse).toBe(true)
    expect(pads.padById('A1')?.settings.gate).toBe(true)
    expect(pads.padById('A2')?.settings.volume).toBe(127)
  })

  it('trades audio and settings with an empty pad', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.updateSettings('A1', { volume: 10 })
    pads.updateSettings('C5', { volume: 90 })

    pads.swapPads('A1', 'C5')

    expect(pads.padById('A1')?.slot).toBe(0)
    expect(pads.padById('C5')?.slot).toBe(28)
    expect(pads.padById('A1')?.audio).toBeNull()
    expect(pads.padById('A1')?.settings.volume).toBe(90)
    expect(pads.padById('C5')?.audio).toEqual(diskAudio('kick.wav'))
    expect(pads.padById('C5')?.settings.volume).toBe(10)
  })

  it('puts everything back when the same swap is made twice', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.updateSettings('A1', { volume: 10 })
    pads.updateSettings('C5', { volume: 90 })

    pads.swapPads('A1', 'C5')
    pads.swapPads('A1', 'C5')

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('kick.wav'))
    expect(pads.padById('A1')?.settings.volume).toBe(10)
    expect(pads.padById('C5')?.audio).toBeNull()
    expect(pads.padById('C5')?.settings.volume).toBe(90)
  })

  it('exchanges both pads when each one holds audio', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.assignAudio('C5', diskAudio('snare.wav'))
    pads.updateSettings('A1', { volume: 10 })
    pads.updateSettings('C5', { volume: 90 })

    pads.swapPads('A1', 'C5')

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('snare.wav'))
    expect(pads.padById('A1')?.settings.volume).toBe(90)
    expect(pads.padById('C5')?.audio).toEqual(diskAudio('kick.wav'))
    expect(pads.padById('C5')?.settings.volume).toBe(10)
  })

  it('leaves two empty pads alone', () => {
    const pads = usePadsStore()
    pads.updateSettings('A1', { volume: 10 })

    pads.swapPads('A1', 'C5')

    expect(pads.padById('A1')?.settings.volume).toBe(10)
    expect(pads.padById('C5')?.settings.volume).toBe(127)
  })

  it('ignores swaps addressing the same pad or an unknown pad', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))

    pads.swapPads('A1', 'A1')
    pads.swapPads('A1', 'Z9')

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('kick.wav'))
  })
})

function cardWith(files: Record<number, string>, sources: Record<number, string> = {}): CardState {
  return {
    root: '/card',
    fingerprint: `fp-${Object.values(files).join('-')}`,
    slots: Array.from({ length: PAD_COUNT }, (_unused, slot) => {
      const fileName = files[slot]
      const sourcePath = sources[slot]
      return {
        slot,
        settings: {
          volume: 127,
          lofi: false,
          loop: false,
          gate: true,
          reverse: false,
          tempoMode: 'off' as const,
          originalTempo: 120,
          userTempo: 120,
        },
        sample: fileName
          ? {
              fileName,
              path: `/card/${fileName}`,
              fingerprint: `fp-${fileName}`,
              format: 'wave' as const,
              channels: 2,
              frames: 1_000,
              sizeBytes: 4_512,
              startFrame: 0,
              endFrame: 1_000,
              ...(sourcePath ? { sourcePath } : {}),
            }
          : null,
      }
    }),
  }
}

describe('pads store and the file a card sample came from', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('takes the file the backend knows a card sample came from, and none where it knows none', () => {
    const pads = usePadsStore()

    pads.loadFromCard(
      cardWith({ 0: 'A0000001.WAV', 1: 'A0000002.WAV' }, { 0: '/samples/kick.wav' }),
    )

    expect(pads.padById('A1')?.audio).toMatchObject({
      kind: 'card',
      fileName: 'A0000001.WAV',
      sourcePath: '/samples/kick.wav',
    })
    expect(pads.padById('A2')?.audio).not.toHaveProperty('sourcePath')
  })

  it('carries that file along when the pad is moved before the next sync', () => {
    const pads = usePadsStore()
    pads.loadFromCard(cardWith({ 0: 'A0000001.WAV' }, { 0: '/samples/kick.wav' }))

    pads.swapPads('A1', 'A2')

    expect(pads.padById('A2')?.audio).toMatchObject({
      originSlot: 0,
      sourcePath: '/samples/kick.wav',
    })
  })

  it('gives no file to a slot the sync did not reach, which stays pending instead', () => {
    const pads = usePadsStore()
    pads.loadFromCard(cardWith({}))
    pads.assignAudio('A1', diskAudio('/samples/kick.wav'))

    pads.adoptCard(cardWith({}), new Set())

    expect(pads.padById('A1')?.audio).toEqual(diskAudio('/samples/kick.wav'))
    expect(pads.changeFor('A1')?.status).toBe('added')
  })
})

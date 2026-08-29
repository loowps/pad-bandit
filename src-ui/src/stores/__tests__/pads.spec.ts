import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePadsStore } from '@/stores/pads'
import {
  BANK_NAMES,
  createDefaultSettings,
  diskAudio,
  PAD_COUNT,
  PADS_PER_BANK,
} from '@/domain/pad'

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

  it('moves audio and settings onto an empty pad and resets the one it left', () => {
    const pads = usePadsStore()
    pads.assignAudio('A1', diskAudio('kick.wav'))
    pads.updateSettings('A1', { volume: 10 })
    pads.updateSettings('C5', { volume: 90 })

    pads.swapPads('A1', 'C5')

    expect(pads.padById('A1')?.slot).toBe(0)
    expect(pads.padById('C5')?.slot).toBe(28)
    expect(pads.padById('A1')?.audio).toBeNull()
    expect(pads.padById('A1')?.settings).toEqual(createDefaultSettings())
    expect(pads.padById('C5')?.audio).toEqual(diskAudio('kick.wav'))
    expect(pads.padById('C5')?.settings.volume).toBe(10)
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

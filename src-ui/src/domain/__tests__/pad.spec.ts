import { describe, expect, it } from 'vitest'
import {
  audioSourceName,
  bankOfSlot,
  diskAudio,
  numberInBank,
  PAD_COUNT,
  padIdAfterBankSwap,
  padIdForSlot,
} from '@/domain/pad'

describe('pad addressing', () => {
  it('maps slots onto bank and number', () => {
    expect(padIdForSlot(0)).toBe('A1')
    expect(padIdForSlot(11)).toBe('A12')
    expect(padIdForSlot(12)).toBe('B1')
    expect(padIdForSlot(PAD_COUNT - 1)).toBe('J12')
  })

  it('rejects slots outside the card', () => {
    expect(() => bankOfSlot(PAD_COUNT)).toThrow(RangeError)
    expect(() => bankOfSlot(-1)).toThrow(RangeError)
  })

  it('numbers pads from one within their bank', () => {
    expect(numberInBank(0)).toBe(1)
    expect(numberInBank(11)).toBe(12)
    expect(numberInBank(12)).toBe(1)
  })

  it('follows a pad to the bank it was swapped into, from either side', () => {
    expect(padIdAfterBankSwap(2, 'A', 'C')).toBe('C3')
    expect(padIdAfterBankSwap(26, 'A', 'C')).toBe('A3')
    expect(padIdAfterBankSwap(11, 'A', 'J')).toBe('J12')
  })

  it('leaves a pad outside both banks where it is', () => {
    expect(padIdAfterBankSwap(14, 'A', 'C')).toBe('B3')
    expect(padIdAfterBankSwap(2, 'A', 'A')).toBe('A3')
  })
})

describe('audioSourceName', () => {
  it('takes the file name from a windows path', () => {
    expect(audioSourceName(diskAudio(String.raw`D:\test\break.wav`))).toBe('break.wav')
  })

  it('takes the file name from a posix path', () => {
    expect(audioSourceName(diskAudio('/home/test/samples/break.wav'))).toBe('break.wav')
  })

  it('falls back to the whole path when there is no separator', () => {
    expect(audioSourceName(diskAudio('break.wav'))).toBe('break.wav')
  })
})

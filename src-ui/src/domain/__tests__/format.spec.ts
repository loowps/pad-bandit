import { describe, expect, it } from 'vitest'
import {
  channelsLabel,
  clockTime,
  folderTrail,
  preciseTime,
  sampleRateLabel,
} from '@/domain/format'

describe('format', () => {
  it('writes clock time as minutes and whole seconds', () => {
    expect(clockTime(7)).toBe('0:07')
    expect(clockTime(125.9)).toBe('2:05')
    expect(clockTime(-3)).toBe('0:00')
  })

  it('writes precise time with hundredths', () => {
    expect(preciseTime(0.04)).toBe('0:00.04')
    expect(preciseTime(61.712)).toBe('1:01.71')
  })

  it('shortens the sample rate', () => {
    expect(sampleRateLabel(44100)).toBe('44.1 kHz')
    expect(sampleRateLabel(48000)).toBe('48 kHz')
  })

  it('names the channel layout', () => {
    expect(channelsLabel(1)).toBe('mono')
    expect(channelsLabel(2)).toBe('stereo')
    expect(channelsLabel(6)).toBe('6 channels')
  })

  it('trails the folders a file sits in, without the file itself', () => {
    expect(folderTrail(String.raw`D:\Samples\Acoustic Kit\Toms\rack.wav`)).toBe(
      'Samples / Acoustic Kit / Toms',
    )
    expect(folderTrail('/kick.wav')).toBe('')
  })
})

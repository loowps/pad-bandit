import { describe, expect, it } from 'vitest'
import {
  createDefaultSettings,
  createPad,
  diskAudio,
  padMatchesSnapshot,
  sameAudioRef,
  sameSettings,
  snapshotOf,
} from '@/domain/pad'

describe('sameAudioRef', () => {
  it('treats two empty pads as equal', () => {
    expect(sameAudioRef(null, null)).toBe(true)
  })

  it('treats an assignment against nothing as different', () => {
    expect(sameAudioRef(null, diskAudio('a.wav'))).toBe(false)
    expect(sameAudioRef(diskAudio('a.wav'), null)).toBe(false)
  })

  it('compares card paths by value', () => {
    expect(sameAudioRef(diskAudio('a.wav'), diskAudio('a.wav'))).toBe(true)
    expect(sameAudioRef(diskAudio('a.wav'), diskAudio('b.wav'))).toBe(false)
  })
})

describe('sameSettings', () => {
  it('accepts a copy', () => {
    const settings = createDefaultSettings()

    expect(sameSettings(settings, { ...settings })).toBe(true)
  })

  it('rejects any single differing field', () => {
    const settings = createDefaultSettings()
    const fields = Object.keys(settings) as (keyof typeof settings)[]

    for (const field of fields) {
      const changed = { ...settings }
      changed[field] = (
        typeof settings[field] === 'boolean' ? !settings[field] : (settings[field] as number) + 1
      ) as never

      expect(sameSettings(settings, changed), `field ${field}`).toBe(false)
    }
  })
})

describe('padMatchesSnapshot', () => {
  it('matches a pad against its own snapshot', () => {
    const pad = createPad(0)

    expect(padMatchesSnapshot(pad, snapshotOf(pad))).toBe(true)
  })

  it('is unaffected by later edits to the pad', () => {
    const pad = createPad(0)
    const baseline = snapshotOf(pad)

    pad.settings.volume = 3

    expect(padMatchesSnapshot(pad, baseline)).toBe(false)
  })
})

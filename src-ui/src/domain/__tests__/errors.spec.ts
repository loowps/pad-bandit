import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODES_WITH_COPY, explain } from '@/domain/errors'

const FALLBACK = 'That folder could not be opened.'

const CODES_RUST_SENDS: string[] = JSON.parse(
  readFileSync(resolve(process.cwd(), '../src-tauri/tests/fixtures/error-codes.json'), 'utf8'),
)

describe('explaining what the backend refused', () => {
  it('says it in the app’s own words when it knows the code', () => {
    expect(
      explain(
        { code: 'cardChanged', message: 'the card changed since this plan was built' },
        FALLBACK,
      ),
    ).toBe('The card changed since it was read. Read it again.')
  })

  it('passes the backend message through for a code it has no words for', () => {
    expect(explain({ code: 'audio', message: 'unsupported codec' }, FALLBACK)).toBe(
      'unsupported codec',
    )
  })

  it('never leaves the user with an empty line', () => {
    expect(explain({ code: 'io', message: '' }, FALLBACK)).toBe(FALLBACK)
    expect(explain(undefined, FALLBACK)).toBe(FALLBACK)
    expect(explain({ nothing: true }, FALLBACK)).toBe(FALLBACK)
  })

  it('still reads a plain Error, which is all a test double throws', () => {
    expect(explain(new Error('the backend is gone'), FALLBACK)).toBe('the backend is gone')
  })

  it('has words only for codes the backend still sends', () => {
    expect(CODES_RUST_SENDS.length).toBeGreaterThan(0)

    for (const code of CODES_WITH_COPY) {
      expect(CODES_RUST_SENDS).toContain(code)
    }
  })

  it('takes a bare string as the message it is', () => {
    expect(explain('no audio output device is available', FALLBACK)).toBe(
      'no audio output device is available',
    )
  })
})

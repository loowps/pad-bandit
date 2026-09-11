import { describe, expect, it } from 'vitest'
import { revealLabel } from '@/domain/platform'

const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36'

describe('revealLabel', () => {
  it('names the file manager each platform ships', () => {
    expect(revealLabel(WINDOWS)).toBe('Show in Explorer')
    expect(revealLabel(MAC)).toBe('Reveal in Finder')
    expect(revealLabel(LINUX)).toBe('Show in file manager')
  })

  it('falls back to neutral wording for anything unrecognised', () => {
    expect(revealLabel('')).toBe('Show in file manager')
  })
})

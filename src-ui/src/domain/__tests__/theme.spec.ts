import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@/domain/theme'

describe('resolveTheme', () => {
  it('follows the system preference when no mode was chosen', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('ignores the system preference once a mode is chosen', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

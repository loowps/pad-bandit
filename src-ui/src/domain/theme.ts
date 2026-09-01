import type { Theme } from '@/config'

export type ResolvedTheme = 'light' | 'dark'

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light'
  }
  return theme
}

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useUiStore,
} from '@/stores/ui'

describe('sidebar width', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts at the default width', () => {
    expect(useUiStore().sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH)
  })

  it('accepts a width inside the allowed range', () => {
    const ui = useUiStore()

    ui.setSidebarWidth(320)

    expect(ui.sidebarWidth).toBe(320)
  })

  it('clamps to the minimum', () => {
    const ui = useUiStore()

    ui.setSidebarWidth(10)

    expect(ui.sidebarWidth).toBe(SIDEBAR_MIN_WIDTH)
  })

  it('clamps to the maximum', () => {
    const ui = useUiStore()

    ui.setSidebarWidth(5000)

    expect(ui.sidebarWidth).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('rounds to whole pixels', () => {
    const ui = useUiStore()

    ui.setSidebarWidth(287.6)

    expect(ui.sidebarWidth).toBe(288)
  })
})

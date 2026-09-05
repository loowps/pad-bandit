import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TOASTS_ON_SCREEN, useNoticesStore } from '@/stores/notices'
import { TOAST_LIFETIME_MS } from '@/domain/notices'

describe('notices store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a new notice as a toast and keeps it in the log afterwards', () => {
    const notices = useNoticesStore()

    notices.notify({ severity: 'info', source: 'sync', title: 'Sync finished' })

    expect(notices.toasts).toHaveLength(1)

    vi.advanceTimersByTime(TOAST_LIFETIME_MS.info)

    expect(notices.toasts).toHaveLength(0)
    expect(notices.entries).toHaveLength(1)
  })

  it('leaves an error on screen longer than a remark', () => {
    const notices = useNoticesStore()

    notices.notify({ severity: 'error', source: 'card', title: 'The card went away' })
    vi.advanceTimersByTime(TOAST_LIFETIME_MS.info)

    expect(notices.toasts).toHaveLength(1)
  })

  it('shows only the newest few at once', () => {
    const notices = useNoticesStore()

    for (let index = 0; index < TOASTS_ON_SCREEN + 2; index += 1) {
      notices.notify({ severity: 'info', source: `source${index}`, title: `notice ${index}` })
    }

    expect(notices.toasts).toHaveLength(TOASTS_ON_SCREEN)
    expect(notices.toasts[0]?.title).toBe(`notice ${TOASTS_ON_SCREEN + 1}`)
  })

  it('hides a toast without losing it from the log', () => {
    const notices = useNoticesStore()
    const id = notices.notify({ severity: 'info', source: 'sync', title: 'Sync finished' })

    notices.hide(id)

    expect(notices.toasts).toEqual([])
    expect(notices.entries).toHaveLength(1)
  })

  it('drops a notice from the log when it is dismissed there', () => {
    const notices = useNoticesStore()
    const id = notices.notify({ severity: 'info', source: 'sync', title: 'Sync finished' })

    notices.dismiss(id)

    expect(notices.entries).toEqual([])
  })

  it('takes back a notice once the trouble behind it is over', () => {
    const notices = useNoticesStore()
    notices.notify({ severity: 'error', source: 'card', title: 'The card went away' })

    notices.resolve('card')

    expect(notices.entries).toEqual([])
    expect(notices.toasts).toEqual([])
  })

  it('lets a second notice from one source replace the first', () => {
    const notices = useNoticesStore()

    notices.notify({ severity: 'error', source: 'project', title: 'Could not be saved' })
    notices.notify({ severity: 'error', source: 'project', title: 'Could not be opened' })

    expect(notices.entries).toHaveLength(1)
    expect(notices.toasts).toHaveLength(1)
    expect(notices.entries[0]?.title).toBe('Could not be opened')
  })

  it('counts messages rather than mishaps when one source keeps failing', () => {
    const notices = useNoticesStore()

    notices.notify({ severity: 'error', source: 'audio:playback', title: 'Playback stopped' })
    notices.notify({ severity: 'error', source: 'audio:playback', title: 'Playback stopped' })
    notices.notify({ severity: 'error', source: 'audio:playback', title: 'Playback stopped' })

    expect(notices.entries).toHaveLength(1)
    expect(notices.unseen).toBe(1)
  })

  it('counts what has not been read, and clears the count when the list is opened', () => {
    const notices = useNoticesStore()
    notices.notify({ severity: 'info', source: 'sync', title: 'Sync finished' })
    notices.notify({ severity: 'info', source: 'pads:fill', title: 'Filled 2 pads' })

    expect(notices.unseen).toBe(2)

    notices.toggle()

    expect(notices.unseen).toBe(0)
  })

  it('holds a toast while it is under the pointer', () => {
    const notices = useNoticesStore()
    notices.notify({ severity: 'info', source: 'sync', title: 'Sync finished' })

    notices.holdToasts()
    vi.advanceTimersByTime(TOAST_LIFETIME_MS.info * 2)

    expect(notices.toasts).toHaveLength(1)

    notices.releaseToasts()
    vi.advanceTimersByTime(TOAST_LIFETIME_MS.info)

    expect(notices.toasts).toEqual([])
  })

  it('empties the log on request and shuts the list with it', () => {
    const notices = useNoticesStore()
    notices.notify({ severity: 'error', source: 'card', title: 'The card went away' })
    notices.toggle()

    notices.clear()

    expect(notices.entries).toEqual([])
    expect(notices.unseen).toBe(0)
    expect(notices.isOpen).toBe(false)
  })

  it('does not spring the list open again on the next notice', () => {
    const notices = useNoticesStore()
    const id = notices.notify({ severity: 'error', source: 'card', title: 'The card went away' })
    notices.toggle()

    notices.dismiss(id)
    notices.notify({ severity: 'info', source: 'sync', title: 'Sync finished' })

    expect(notices.isOpen).toBe(false)
  })

  it('lets the timers run again after the last held toast is hidden', () => {
    const notices = useNoticesStore()
    const id = notices.notify({ severity: 'info', source: 'sync', title: 'Sync finished' })
    notices.holdToasts()

    notices.hide(id)
    notices.notify({ severity: 'info', source: 'pads:fill', title: 'Filled 2 pads' })
    vi.advanceTimersByTime(TOAST_LIFETIME_MS.info)

    expect(notices.toasts).toEqual([])
  })

  it('reports the worst thing standing', () => {
    const notices = useNoticesStore()

    notices.notify({ severity: 'info', source: 'sync', title: 'Sync finished' })
    notices.notify({ severity: 'error', source: 'card', title: 'The card went away' })

    expect(notices.worst).toBe('error')
  })
})

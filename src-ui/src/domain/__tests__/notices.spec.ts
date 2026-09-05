import { describe, expect, it } from 'vitest'
import {
  elapsedLabel,
  type Notice,
  NOTICE_LIMIT,
  withNotice,
  withoutSource,
  worstSeverity,
} from '@/domain/notices'

function notice(id: number, source: string, severity: Notice['severity'] = 'info'): Notice {
  return {
    id,
    severity,
    source,
    title: `notice ${id}`,
    detail: null,
    action: null,
    at: id,
  }
}

describe('collecting notices', () => {
  it('puts the newest first', () => {
    const kept = withNotice([notice(1, 'card')], notice(2, 'project'))

    expect(kept.map((entry) => entry.id)).toEqual([2, 1])
  })

  it('replaces the one the same source already left', () => {
    const kept = withNotice([notice(1, 'project'), notice(2, 'card')], notice(3, 'project'))

    expect(kept.map((entry) => entry.id)).toEqual([3, 2])
  })

  it('forgets the oldest once the log is full', () => {
    const full = Array.from({ length: NOTICE_LIMIT }, (_unused, index) =>
      notice(index, `source${index}`),
    )

    const kept = withNotice(full, notice(999, 'newest'))

    expect(kept).toHaveLength(NOTICE_LIMIT)
    expect(kept[0]?.id).toBe(999)
    expect(kept[kept.length - 1]?.id).toBe(NOTICE_LIMIT - 2)
  })

  it('drops every notice a source left behind', () => {
    const kept = withoutSource([notice(1, 'project'), notice(2, 'card')], 'project')

    expect(kept.map((entry) => entry.id)).toEqual([2])
  })
})

describe('the worst thing in the log', () => {
  it('is nothing when the log is empty', () => {
    expect(worstSeverity([])).toBeNull()
  })

  it('outranks a warning with an error whichever came first', () => {
    expect(worstSeverity([notice(1, 'a', 'error'), notice(2, 'b', 'warning')])).toBe('error')
    expect(worstSeverity([notice(1, 'a', 'warning'), notice(2, 'b', 'error')])).toBe('error')
  })

  it('reports a warning over plain information', () => {
    expect(worstSeverity([notice(1, 'a', 'info'), notice(2, 'b', 'warning')])).toBe('warning')
  })
})

describe('saying how long ago something happened', () => {
  const now = 10 * 60 * 60 * 1000

  it('calls the last minute just now', () => {
    expect(elapsedLabel(now - 59_000, now)).toBe('just now')
  })

  it('counts minutes, then hours', () => {
    expect(elapsedLabel(now - 3 * 60_000, now)).toBe('3 min ago')
    expect(elapsedLabel(now - 125 * 60_000, now)).toBe('2 h ago')
  })

  it('never runs backwards', () => {
    expect(elapsedLabel(now + 5_000, now)).toBe('just now')
  })
})

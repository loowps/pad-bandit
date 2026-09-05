export type NoticeSeverity = 'error' | 'warning' | 'info'

export interface NoticeAction {
  label: string
  run: () => void
}

export interface NoticeInput {
  severity: NoticeSeverity
  source: string
  title: string
  detail?: string
  action?: NoticeAction
}

export interface Notice {
  id: number
  severity: NoticeSeverity
  source: string
  title: string
  detail: string | null
  action: NoticeAction | null
  at: number
}

export const NOTICE_LIMIT = 40

export const TOAST_LIFETIME_MS: Record<NoticeSeverity, number> = {
  error: 12_000,
  warning: 9_000,
  info: 6_000,
}

const BY_WEIGHT: NoticeSeverity[] = ['info', 'warning', 'error']

export function withNotice(entries: Notice[], notice: Notice): Notice[] {
  return [notice, ...withoutSource(entries, notice.source)].slice(0, NOTICE_LIMIT)
}

export function withoutSource(entries: Notice[], source: string): Notice[] {
  return entries.filter((entry) => entry.source !== source)
}

export function worstSeverity(entries: Notice[]): NoticeSeverity | null {
  return entries.reduce<NoticeSeverity | null>(
    (worst, entry) =>
      worst === null || BY_WEIGHT.indexOf(entry.severity) > BY_WEIGHT.indexOf(worst)
        ? entry.severity
        : worst,
    null,
  )
}

export function elapsedLabel(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes} min ago`
  }
  return `${Math.floor(minutes / 60)} h ago`
}

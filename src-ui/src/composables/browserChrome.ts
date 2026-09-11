const TEXT_FIELDS =
  'textarea, [contenteditable="true"], input:not([type]), input[type="text"], input[type="search"], input[type="number"]'

export function textFieldAt(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(TEXT_FIELDS) : null
}

export function blockBrowserMenu(event: MouseEvent): void {
  if (!textFieldAt(event.target)) {
    event.preventDefault()
  }
}

export function blockBrowserShortcuts(event: KeyboardEvent): void {
  const key = event.key.toLowerCase()
  const withCommand = event.ctrlKey || event.metaKey
  if (event.key === 'F5' || (withCommand && (key === 'r' || key === 'p'))) {
    event.preventDefault()
  }
}

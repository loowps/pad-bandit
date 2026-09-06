import { type MenuItem, showContextMenu } from '@/composables/useContextMenu'
import { baseName, getFileSystemGateway } from '@/filesystem'
import { explain } from '@/domain/errors'
import { revealLabel, simplifiedPath } from '@/domain/platform'
import { useNoticesStore } from '@/stores/notices'

export function showPathMenu(event: MouseEvent, path: string | null): void {
  showContextMenu(event, pathMenuItems(path))
}

export function pathMenuItems(path: string | null): MenuItem[] {
  return [
    {
      label: revealLabel(navigator.userAgent),
      disabled: path === null,
      run: () => reveal(path),
    },
    {
      label: 'Copy path',
      disabled: path === null,
      run: () => copyPath(path),
    },
  ]
}

async function reveal(path: string | null): Promise<void> {
  if (path === null) {
    return
  }

  const notices = useNoticesStore()
  try {
    await getFileSystemGateway().revealInFileManager(path)
    notices.resolve('reveal')
  } catch (cause) {
    notices.notify({
      severity: 'warning',
      source: 'reveal',
      title: `${baseName(path)} could not be shown`,
      detail: explain(cause, 'The file manager did not open.'),
    })
  }
}

async function copyPath(path: string | null): Promise<void> {
  if (path === null) {
    return
  }

  const notices = useNoticesStore()
  const copied = simplifiedPath(path)

  if (await writeToClipboard(copied)) {
    notices.notify({ severity: 'info', source: 'clipboard', title: 'Path copied', detail: copied })
  } else {
    notices.notify({
      severity: 'warning',
      source: 'clipboard',
      title: 'The path could not be copied',
      detail: copied,
    })
  }
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyThroughSelection(text)
  }
}

function copyThroughSelection(text: string): boolean {
  const holder = document.createElement('textarea')
  holder.value = text
  holder.setAttribute('readonly', '')
  holder.style.position = 'fixed'
  holder.style.opacity = '0'
  document.body.append(holder)
  holder.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    holder.remove()
  }
}

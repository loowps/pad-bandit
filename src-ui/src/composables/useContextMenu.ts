import { computed, ref } from 'vue'

export interface MenuItem {
  label: string
  disabled: boolean
  run: () => void | Promise<void>
}

export interface OpenMenu {
  x: number
  y: number
  items: MenuItem[]
}

const menu = ref<OpenMenu | null>(null)

export const openMenu = computed(() => menu.value)

export function showContextMenu(event: MouseEvent, items: MenuItem[]): void {
  if (items.length === 0) {
    return
  }
  menu.value = { ...originOf(event), items }
}

export function hideContextMenu(): void {
  menu.value = null
}

function originOf(event: MouseEvent): { x: number; y: number } {
  if (event.clientX > 0 || event.clientY > 0) {
    return { x: event.clientX, y: event.clientY }
  }

  const anchor = event.currentTarget
  if (anchor instanceof HTMLElement) {
    const box = anchor.getBoundingClientRect()
    return { x: box.left, y: box.bottom }
  }
  return { x: 0, y: 0 }
}

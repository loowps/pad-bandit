import { computed, onScopeDispose, type Ref, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

const stack = ref<HTMLElement[]>([])

export const aDialogIsOpen = computed(() => stack.value.length > 0)

export function useDialog(surface: Ref<HTMLElement | null>, close?: () => void): void {
  let opener: HTMLElement | null = null
  let onStack: HTMLElement | null = null

  function stopsWithin(element: HTMLElement): HTMLElement[] {
    return [...element.querySelectorAll<HTMLElement>(FOCUSABLE)]
  }

  function forget(element: HTMLElement): void {
    stack.value = stack.value.filter((open) => open !== element)
  }

  function isOnTop(element: HTMLElement): boolean {
    return stack.value[stack.value.length - 1] === element
  }

  watch(
    surface,
    (element, previous) => {
      if (previous) {
        forget(previous)
      }
      onStack = element
      if (element) {
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
        stack.value = [...stack.value, element]
        stopsWithin(element)[0]?.focus()
      } else if (previous) {
        opener?.focus()
        opener = null
      }
    },
    { flush: 'post' },
  )

  onScopeDispose(() => {
    if (onStack) {
      forget(onStack)
      onStack = null
    }
  })

  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    const element = surface.value
    if (!element || !isOnTop(element)) {
      return
    }

    if (event.key === 'Escape') {
      if (close) {
        event.preventDefault()
        close()
      }
      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const stops = stopsWithin(element)
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (!first || !last) {
      return
    }

    const active = document.activeElement
    if (event.shiftKey && (active === first || !element.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  })
}

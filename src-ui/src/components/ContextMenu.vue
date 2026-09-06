<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import {
  hideContextMenu,
  type MenuItem,
  type OpenMenu,
  openMenu,
} from '@/composables/useContextMenu'

const EDGE_GAP_PX = 8

const surface = useTemplateRef<HTMLElement>('surface')
const position = ref({ x: 0, y: 0 })
let opener: HTMLElement | null = null

watch(openMenu, async (menu) => {
  if (!menu) {
    opener?.focus()
    opener = null
    return
  }

  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  position.value = { x: menu.x, y: menu.y }
  await nextTick()
  keepInsideViewport(menu)
  focusItem(0)
})

function keepInsideViewport(menu: OpenMenu): void {
  const element = surface.value
  if (!element) {
    return
  }
  const rightmost = window.innerWidth - element.offsetWidth - EDGE_GAP_PX
  const lowest = window.innerHeight - element.offsetHeight - EDGE_GAP_PX
  position.value = {
    x: Math.max(EDGE_GAP_PX, Math.min(menu.x, rightmost)),
    y: Math.max(EDGE_GAP_PX, Math.min(menu.y, lowest)),
  }
}

function enabledItems(): HTMLButtonElement[] {
  return [...(surface.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
}

function focusItem(index: number): void {
  const buttons = enabledItems()
  if (buttons.length === 0) {
    surface.value?.focus()
    return
  }
  buttons[((index % buttons.length) + buttons.length) % buttons.length]?.focus()
}

function stepFocus(delta: number): void {
  const buttons = enabledItems()
  const active = document.activeElement
  const at = buttons.findIndex((button) => button === active)
  focusItem(at === -1 ? 0 : at + delta)
}

function activate(item: MenuItem): void {
  hideContextMenu()
  void item.run()
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (!openMenu.value) {
    return
  }

  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    hideContextMenu()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    stepFocus(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    stepFocus(-1)
  }
})

useEventListener(window, 'pointerdown', (event: PointerEvent) => {
  const element = surface.value
  if (element && !event.composedPath().includes(element)) {
    hideContextMenu()
  }
})

useEventListener(window, 'blur', hideContextMenu)
useEventListener(window, 'resize', hideContextMenu)
useEventListener(window, 'scroll', hideContextMenu, true)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="openMenu"
      ref="surface"
      class="menu"
      role="menu"
      tabindex="-1"
      aria-label="Actions"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      @contextmenu.prevent
    >
      <button
        v-for="item in openMenu.items"
        :key="item.label"
        type="button"
        class="item"
        role="menuitem"
        :disabled="item.disabled"
        @click="activate(item)"
      >
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 11rem;
  padding: 0.25rem;
  color: var(--text-default);
  background: var(--panel-surface);
  border: 1px solid var(--panel-border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
}

.menu:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.item {
  padding: 0.3125rem 0.625rem;
  font: inherit;
  font-size: 0.8125rem;
  color: inherit;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
}

.item:hover:not(:disabled) {
  background: var(--control-track);
}

.item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.item:disabled {
  color: var(--text-subtle);
  cursor: default;
}
</style>

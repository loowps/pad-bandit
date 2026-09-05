<script setup lang="ts">
import { computed } from 'vue'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { numberInBank, type Pad } from '@/domain/pad'

const CHANGE_LABELS = {
  settings: 'settings changed',
  moved: 'moved from another pad',
  replaced: 'sample replaced',
  added: 'sample added',
  removed: 'sample removed',
} as const

const props = defineProps<{ pad: Pad }>()

const pads = usePadsStore()
const ui = useUiStore()

const label = computed(() => numberInBank(props.pad.slot))
const isSelected = computed(() => ui.selectedPadId === props.pad.id)
const hasAudio = computed(() => props.pad.audio !== null)
const change = computed(() => pads.changeFor(props.pad.id))

const state = computed(() => {
  if (hasAudio.value) {
    return change.value ? 'unsynced' : 'synced'
  }
  return change.value ? 'pending' : 'empty'
})

const padLabel = computed(() => {
  const status = change.value?.status
  return status ? `Pad ${props.pad.id}, ${CHANGE_LABELS[status]}` : `Pad ${props.pad.id}`
})

function handleClearKey(event: KeyboardEvent): void {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    pads.clearPad(props.pad.id)
  }
}

function handleDragStart(): void {
  ui.startDrag({ source: 'pad', padId: props.pad.id })
}

function handleDrop(): void {
  const payload = ui.dragPayload
  ui.endDrag()

  if (payload?.source === 'audio') {
    pads.assignAudio(props.pad.id, payload.audio)
  } else if (payload?.source === 'pad') {
    pads.swapPads(props.pad.id, payload.padId)
  } else {
    return
  }

  ui.selectPad(props.pad.id)
}
</script>

<template>
  <button
    type="button"
    class="pad"
    :class="{ 'is-selected': isSelected }"
    :data-state="state"
    :data-change="change?.status"
    :aria-label="padLabel"
    :title="padLabel"
    :aria-pressed="isSelected"
    draggable="true"
    @click="ui.selectPad(pad.id)"
    @keydown="handleClearKey"
    @dragstart="handleDragStart"
    @dragend="ui.endDrag()"
    @dragover.prevent
    @drop.prevent="handleDrop"
  >
    <span class="pad-number">{{ label }}</span>
  </button>
</template>

<style scoped>
.pad {
  position: relative;
  container-type: size;
  display: grid;
  place-items: start center;
  aspect-ratio: 23 / 20;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--pad-empty-label);
  background-color: var(--pad-empty-surface);
  border: 1px solid var(--pad-empty-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.pad-number {
  font-size: 40cqh;
}

.pad:hover {
  border-color: var(--text-subtle);
}

.pad[data-state='synced'] {
  color: var(--pad-synced-label);
  background-color: var(--pad-synced-surface);
  border-color: var(--pad-synced-border);
}

.pad[data-state='synced']:hover {
  background-color: var(--pad-synced-surface-hover);
}

.pad[data-state='unsynced'] {
  color: var(--pad-unsynced-label);
  background-color: var(--pad-unsynced-surface);
  border-color: var(--pad-unsynced-border);
}

.pad[data-state='unsynced']:hover {
  background-color: var(--pad-unsynced-surface-hover);
}

.pad[data-state='pending'] {
  color: var(--pad-pending-label);
  background-color: var(--pad-pending-surface);
  border-color: var(--pad-unsynced-border);
  border-style: dashed;
}

.pad.is-selected {
  color: var(--pad-selected-label);
  background-color: var(--pad-selected-surface);
  border-color: var(--pad-selected-border);
}

.pad.is-selected:hover {
  background-color: var(--pad-selected-surface-hover);
}

.pad:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
</style>

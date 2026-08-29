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

  if (payload?.source === 'audio') {
    pads.assignAudio(props.pad.id, payload.audio)
  } else if (payload?.source === 'pad') {
    pads.swapPads(props.pad.id, payload.padId)
  }

  ui.endDrag()
  ui.selectPad(props.pad.id)
}
</script>

<template>
  <button
    type="button"
    class="pad"
    :class="{ 'is-selected': isSelected, 'has-audio': hasAudio, 'is-prepared': change !== null }"
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
  font-weight: 700;
  color: var(--pad-label);
  background-color: var(--pad-surface);
  border: 1px solid var(--pad-border);
  border-radius: 3px;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}

.pad.is-prepared::after {
  position: absolute;
  right: 22%;
  bottom: 3px;
  left: 22%;
  height: 2px;
  content: '';
  background: var(--pad-prepared);
  border-radius: 1px;
}

.pad[data-change='removed']::after {
  background: var(--pad-removed);
}

.pad-number {
  font-size: 40cqh;
}

.pad:hover {
  background-color: var(--pad-surface-hover);
}

.pad:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.pad.has-audio {
  color: var(--pad-label-strong);
  background-color: var(--pad-surface-loaded);
  border-color: var(--pad-border-loaded);
}

.pad.has-audio:hover {
  background-color: var(--pad-surface-loaded-hover);
}

.pad.is-selected {
  color: var(--pad-label-strong);
  background-color: var(--pad-surface-selected);
  border-color: var(--pad-border-selected);
}
</style>

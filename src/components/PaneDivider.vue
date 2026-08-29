<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    size: number
    min: number
    max: number
    resetTo: number
    step?: number
    label?: string
  }>(),
  { step: 16, label: 'Resize panel' },
)

const emit = defineEmits<{ resize: [size: number] }>()

const isDragging = ref(false)

let startX = 0
let startSize = 0

function beginDrag(event: PointerEvent): void {
  startX = event.clientX
  startSize = props.size
  isDragging.value = true
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
}

function continueDrag(event: PointerEvent): void {
  if (isDragging.value) {
    emit('resize', startSize + (event.clientX - startX))
  }
}

function endDrag(event: PointerEvent): void {
  isDragging.value = false
  const element = event.currentTarget as Element
  if (element.hasPointerCapture(event.pointerId)) {
    element.releasePointerCapture(event.pointerId)
  }
}

function nudge(offset: number): void {
  emit('resize', props.size + offset)
}
</script>

<template>
  <div
    class="divider"
    :class="{ 'is-dragging': isDragging }"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuenow="size"
    :aria-valuemin="min"
    :aria-valuemax="max"
    @pointerdown.prevent="beginDrag"
    @pointermove="continueDrag"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @lostpointercapture="endDrag"
    @dblclick="emit('resize', resetTo)"
    @keydown.left.prevent="nudge(-step)"
    @keydown.right.prevent="nudge(step)"
    @keydown.home.prevent="emit('resize', min)"
    @keydown.end.prevent="emit('resize', max)"
  />
</template>

<style scoped>
.divider {
  position: relative;
  z-index: 1;
  flex: 0 0 1px;
  cursor: col-resize;
  background: var(--panel-border);
  touch-action: none;
  transition: background-color 120ms ease;
}

.divider::before {
  position: absolute;
  inset: 0 -3px;
  content: '';
  transition: background-color 120ms ease;
}

.divider:hover,
.divider.is-dragging,
.divider:focus-visible {
  background: transparent;
}

.divider:hover::before,
.divider.is-dragging::before,
.divider:focus-visible::before {
  background: var(--divider-active);
}

.divider:focus-visible {
  outline: none;
}
</style>

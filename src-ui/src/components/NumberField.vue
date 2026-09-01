<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from 'vue'

const DRAG_TRAVEL_PX = 300
const FINE_DIVISOR = 5

const model = defineModel<number>({ required: true })

const props = withDefaults(
  defineProps<{
    label: string
    min: number
    max: number
    step?: number
    suffix?: string
    disabled?: boolean
  }>(),
  { step: 1, suffix: '', disabled: false },
)

const inputId = useId()
const input = useTemplateRef<HTMLInputElement>('input')
const isEditing = ref(false)

const decimals = computed(() => {
  const [, fraction] = String(props.step).split('.')
  return fraction?.length ?? 0
})

const widestValue = computed(() => {
  const digits = Math.max(
    String(Math.trunc(props.min)).length,
    String(Math.trunc(props.max)).length,
  )
  return decimals.value > 0 ? digits + decimals.value + 1 : digits
})

function clamp(value: number): number {
  return Math.min(props.max, Math.max(props.min, value))
}

function snap(value: number): number {
  const stepped = Math.round((value - props.min) / props.step) * props.step + props.min
  return Number(clamp(stepped).toFixed(decimals.value))
}

function isWithinRange(value: number): boolean {
  return value >= props.min && value <= props.max
}

function handleInput(event: Event): void {
  const { valueAsNumber } = event.target as HTMLInputElement
  if (!Number.isNaN(valueAsNumber) && isWithinRange(valueAsNumber)) {
    model.value = valueAsNumber
  }
}

function commit(event: Event): void {
  const field = event.target as HTMLInputElement
  if (!Number.isNaN(field.valueAsNumber)) {
    model.value = clamp(field.valueAsNumber)
  }
  field.value = String(model.value)
}

async function startEditing(): Promise<void> {
  if (props.disabled) {
    return
  }
  isEditing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function stopEditing(): void {
  isEditing.value = false
}

let dragOriginY = 0
let dragOriginValue = 0
let isDragging = false

function unitsPerPixel(fine: boolean): number {
  const span = (props.max - props.min) / DRAG_TRAVEL_PX
  return fine ? span / FINE_DIVISOR : span
}

function beginDrag(event: PointerEvent): void {
  if (props.disabled || isEditing.value) {
    return
  }
  event.preventDefault()
  isDragging = true
  dragOriginY = event.clientY
  dragOriginValue = model.value
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
}

function continueDrag(event: PointerEvent): void {
  if (!isDragging) {
    return
  }
  const travelled = (dragOriginY - event.clientY) * unitsPerPixel(event.shiftKey)
  model.value = snap(dragOriginValue + travelled)
}

function endDrag(event: PointerEvent): void {
  isDragging = false
  const element = event.currentTarget as Element
  if (element.hasPointerCapture(event.pointerId)) {
    element.releasePointerCapture(event.pointerId)
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (isEditing.value) {
    if (event.key === 'Enter' || event.key === 'Escape') {
      input.value?.blur()
    }
    return
  }

  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    const direction = event.key === 'ArrowUp' ? 1 : -1
    model.value = snap(model.value + direction * props.step)
  } else if (event.key === 'Enter' || event.key === 'F2') {
    event.preventDefault()
    void startEditing()
  }
}
</script>

<template>
  <div class="field">
    <label class="field-label" :for="inputId">{{ label }}</label>
    <span
      class="field-box"
      :class="{ 'is-editing': isEditing }"
      :style="{ '--field-characters': widestValue }"
    >
      <input
        :id="inputId"
        ref="input"
        class="field-input"
        type="number"
        :value="model"
        :min="min"
        :max="max"
        :step="step"
        :disabled="disabled"
        :readonly="!isEditing"
        :title="
          isEditing
            ? undefined
            : 'Drag up or down to change · double-click to type · shift for fine'
        "
        @input="handleInput"
        @change="commit"
        @pointerdown="beginDrag"
        @pointermove="continueDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @dblclick="startEditing"
        @keydown="handleKeydown"
        @blur="stopEditing"
      />
      <span v-if="suffix" class="field-suffix">{{ suffix }}</span>
    </span>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.field-label {
  font-size: 0.8125rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.field-box {
  display: flex;
  gap: 0.1875rem;
  align-items: center;
  height: var(--control-height);
  padding: 0 0.4375rem;
  background: var(--control-surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-md);
}

.field-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.field-input {
  width: calc(var(--field-characters) * 1ch);
  padding: 0;
  font: inherit;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: var(--text-default);
  text-align: center;
  cursor: ns-resize;
  user-select: none;
  background: transparent;
  border: 0;
  appearance: textfield;
}

.field-box.is-editing .field-input {
  cursor: text;
  user-select: text;
}

.field-input::-webkit-inner-spin-button,
.field-input::-webkit-outer-spin-button {
  appearance: none;
  margin: 0;
}

.field-input:focus {
  outline: none;
}

.field-input:disabled {
  color: var(--text-subtle);
  cursor: default;
}

.field-suffix {
  font-size: 0.6875rem;
  line-height: 1;
  color: var(--text-muted);
}
</style>

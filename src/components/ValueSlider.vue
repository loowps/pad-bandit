<script setup lang="ts">
import { useId } from 'vue'

const model = defineModel<number>({ required: true })

const props = withDefaults(
  defineProps<{
    label: string
    min: number
    max: number
    step?: number
    disabled?: boolean
  }>(),
  { step: 1, disabled: false },
)

const inputId = useId()

function clamp(value: number): number {
  return Math.min(props.max, Math.max(props.min, value))
}

function isWithinRange(value: number): boolean {
  return value >= props.min && value <= props.max
}

function handleNumberInput(event: Event): void {
  const { valueAsNumber } = event.target as HTMLInputElement
  if (!Number.isNaN(valueAsNumber) && isWithinRange(valueAsNumber)) {
    model.value = valueAsNumber
  }
}

function commitNumberInput(event: Event): void {
  const input = event.target as HTMLInputElement
  if (!Number.isNaN(input.valueAsNumber)) {
    model.value = clamp(input.valueAsNumber)
  }
  input.value = String(model.value)
}
</script>

<template>
  <div class="slider">
    <label class="slider-label" :for="inputId">{{ label }}</label>
    <input
      :id="inputId"
      v-model.number="model"
      class="slider-track"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
    />
    <input
      class="slider-value"
      type="number"
      :value="model"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      @input="handleNumberInput"
      @change="commitNumberInput"
    />
  </div>
</template>

<style scoped>
.slider {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
}

.slider-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.slider-track {
  width: 100%;
  height: 18px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
}

.slider-track:disabled {
  cursor: default;
  opacity: 0.5;
}

.slider-track::-webkit-slider-runnable-track {
  height: 4px;
  background: var(--control-track);
  border-radius: 2px;
}

.slider-track::-moz-range-track {
  height: 4px;
  background: var(--control-track);
  border-radius: 2px;
}

.slider-track::-webkit-slider-thumb {
  width: 13px;
  height: 13px;
  margin-top: -4.5px;
  background: var(--panel-surface);
  border: 2px solid var(--accent);
  border-radius: 50%;
  appearance: none;
}

.slider-track::-moz-range-thumb {
  width: 13px;
  height: 13px;
  background: var(--panel-surface);
  border: 2px solid var(--accent);
  border-radius: 50%;
}

.slider-track:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.slider-value {
  width: 4.5rem;
  padding: 0.25rem 0.375rem;
  font: inherit;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-default);
  text-align: right;
  background: var(--panel-surface);
  border: 1px solid var(--control-border);
  border-radius: 3px;
}

.slider-value:focus-visible {
  border-color: var(--accent);
  outline: 2px solid var(--focus-ring);
  outline-offset: -1px;
}

.slider-value:disabled {
  color: var(--text-muted);
  background: var(--control-track);
}
</style>

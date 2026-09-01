<script setup lang="ts">
const model = defineModel<boolean>({ required: true })

defineProps<{ label: string; disabled?: boolean }>()
</script>

<template>
  <label class="chip" :class="{ on: model }">
    <input v-model="model" type="checkbox" :disabled="disabled" />
    <span>{{ label }}</span>
  </label>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  height: var(--control-height);
  padding: 0 0.6875rem;
  font-size: 0.8125rem;
  line-height: 1;
  color: var(--text-default);
  cursor: pointer;
  user-select: none;
  background: var(--control-surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-pill);
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.chip:hover:not(:has(input:disabled)) {
  border-color: var(--text-subtle);
}

.chip.on {
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-color: var(--accent);
}

.chip:has(input:disabled) {
  color: var(--text-subtle);
  cursor: default;
}

.chip:has(input:focus-visible) {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

<script setup lang="ts">
const model = defineModel<boolean>({ required: true })

defineProps<{ label: string; disabled?: boolean }>()
</script>

<template>
  <label class="checkbox">
    <input v-model="model" type="checkbox" :disabled="disabled" />
    <span>{{ label }}</span>
  </label>
</template>

<style scoped>
.checkbox {
  display: flex;
  gap: 0.4375rem;
  align-items: center;
  font-size: 0.8125rem;
  cursor: pointer;
  user-select: none;
}

.checkbox:has(input:disabled) {
  color: var(--text-muted);
  cursor: default;
}

input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent);
  cursor: inherit;
}

input:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}
</style>

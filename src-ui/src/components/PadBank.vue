<script setup lang="ts">
import PadButton from '@/components/PadButton.vue'
import type { Bank } from '@/stores/pads'

defineProps<{ bank: Bank }>()
</script>

<template>
  <section class="bank">
    <h2 class="bank-name">Bank {{ bank.name }}</h2>
    <div class="pad-grid">
      <PadButton v-for="pad in bank.pads" :key="pad.id" :pad="pad" />
    </div>
  </section>
</template>

<style scoped>
.bank {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem;
  background-color: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: 6px;
}

.bank-name {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.pad-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.3125rem;
}
</style>

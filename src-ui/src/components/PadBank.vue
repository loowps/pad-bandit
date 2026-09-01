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
  gap: 0.625rem;
  padding: 0.875rem;
  background-color: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-lg);
}

.bank-name {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.pad-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4375rem;
}
</style>

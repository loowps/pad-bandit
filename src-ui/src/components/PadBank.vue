<script setup lang="ts">
import { computed } from 'vue'
import PadButton from '@/components/PadButton.vue'
import { type Bank, usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ bank: Bank }>()

const pads = usePadsStore()
const ui = useUiStore()

const isDropTarget = computed(() => {
  const payload = ui.dragPayload
  return payload?.source === 'bank' && payload.bank !== props.bank.name
})

function handleDragStart(): void {
  ui.startDrag({ source: 'bank', bank: props.bank.name })
}

function handleDrop(): void {
  const payload = ui.dragPayload
  ui.endDrag()

  if (payload?.source === 'bank') {
    pads.swapBanks(payload.bank, props.bank.name)
    ui.followBankSwap(payload.bank, props.bank.name)
  }
}
</script>

<template>
  <section class="bank">
    <header
      class="bank-header"
      :class="{ 'is-target': isDropTarget }"
      draggable="true"
      @dragstart="handleDragStart"
      @dragend="ui.endDrag()"
      @dragover.prevent
      @drop.prevent="handleDrop"
    >
      <h2 class="bank-name">Bank {{ bank.name }}</h2>
    </header>
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

.bank-header {
  padding: 0.125rem 0.25rem;
  border: 1px dashed transparent;
  border-radius: var(--radius-sm);
  cursor: grab;
  user-select: none;
}

.bank-header:active {
  cursor: grabbing;
}

.bank-header.is-target {
  border-color: var(--dropzone-border);
}

.bank-header.is-target:hover {
  background-color: var(--accent-soft);
  border-color: var(--accent);
}

.bank-name {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.swap-menu option {
  color: var(--text-default);
  background: var(--control-surface);
}

.pad-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4375rem;
}
</style>

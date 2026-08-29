<script setup lang="ts">
import { storeToRefs } from 'pinia'
import PadBank from '@/components/PadBank.vue'
import { usePadsStore } from '@/stores/pads'

const { banks } = storeToRefs(usePadsStore())
</script>

<template>
  <div class="bank-grid">
    <PadBank v-for="bank in banks" :key="bank.name" :bank="bank" />
  </div>
</template>

<style scoped>
.bank-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;
  padding: 1rem;
  overflow: auto;
}
</style>

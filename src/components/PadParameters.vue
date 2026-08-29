<script setup lang="ts">
import { computed } from 'vue'
import CheckboxField from '@/components/CheckboxField.vue'
import ValueSlider from '@/components/ValueSlider.vue'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { createDefaultSettings, type PadSettings } from '@/domain/pad'

const pads = usePadsStore()
const ui = useUiStore()

const fallbackSettings = createDefaultSettings()

function settingModel<K extends keyof PadSettings>(key: K) {
  return computed<PadSettings[K]>({
    get: () => ui.selectedPad?.settings[key] ?? fallbackSettings[key],
    set: (value) => {
      const pad = ui.selectedPad
      if (pad) {
        pads.updateSettings(pad.id, { [key]: value } as Partial<PadSettings>)
      }
    },
  })
}

const lofi = settingModel('lofi')
const gate = settingModel('gate')
const reverse = settingModel('reverse')
const loop = settingModel('loop')
const userTempo = settingModel('userTempo')
const volume = settingModel('volume')

const hasSelection = computed(() => ui.selectedPad !== null)
</script>

<template>
  <fieldset class="parameters" :disabled="!hasSelection">
    <legend class="sr-only">Pad parameters</legend>

    <div class="toggles">
      <CheckboxField v-model="lofi" label="Lo-Fi" />
      <CheckboxField v-model="gate" label="Gate" />
      <CheckboxField v-model="reverse" label="Reverse" />
      <CheckboxField v-model="loop" label="Loop" />
    </div>

    <ValueSlider
      v-model="userTempo"
      class="slider"
      label="Tempo"
      :min="40"
      :max="200"
      :step="0.1"
    />
    <ValueSlider v-model="volume" class="slider" label="Volume" :min="0" :max="127" />
  </fieldset>
</template>

<style scoped>
.parameters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem 1.5rem;
  align-items: center;
  width: 100%;
  padding: 0.75rem;
  margin: 0;
  background: var(--panel-surface);
  border: 0;
  border-bottom: 1px solid var(--panel-border);
}

.parameters:disabled {
  opacity: 0.55;
}

.toggles {
  display: flex;
  flex: 0 0 auto;
  gap: 0.875rem;
  align-items: center;
}

.slider {
  flex: 1 1 14rem;
  min-width: 11rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

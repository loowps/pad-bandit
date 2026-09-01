<script setup lang="ts">
import { computed } from 'vue'
import { PAD_PLAYBACK, useAudioStore } from '@/stores/audio'
import { usePadsStore } from '@/stores/pads'
import { useUiStore } from '@/stores/ui'
import { audioSourceName, isPadEmpty } from '@/domain/pad'
import { channelsLabel, clockTime, folderTrail, sampleRateLabel } from '@/domain/format'

const ui = useUiStore()
const pads = usePadsStore()
const audio = useAudioStore()

const title = computed(() => {
  const pad = ui.selectedPad
  if (!pad) {
    return 'No pad selected'
  }
  return pad.audio ? audioSourceName(pad.audio) : 'No audio source'
})

const details = computed(() => {
  const pad = ui.selectedPad
  if (!pad) {
    return []
  }

  const parts = [`Pad ${pad.id}`]
  const trail = pad.audio ? folderTrail(pad.audio.path) : ''
  if (trail) {
    parts.push(trail)
  }

  const info = ui.audioInfo
  if (pad.audio && info && info.sampleRate > 0) {
    parts.push(
      sampleRateLabel(info.sampleRate),
      channelsLabel(info.channels),
      clockTime(info.frames / info.sampleRate),
    )
  }
  return parts
})

const canPlay = computed(() => Boolean(ui.selectedPad?.audio))

const isPadPlaying = computed(() => audio.isSourcePlaying(PAD_PLAYBACK))

const syncState = computed<'synced' | 'unsynced' | null>(() => {
  const pad = ui.selectedPad
  if (!pad) {
    return null
  }
  if (pads.isPrepared(pad.id)) {
    return 'unsynced'
  }
  return isPadEmpty(pad) ? null : 'synced'
})
</script>

<template>
  <section class="toolbar" aria-label="Selected pad">
    <button
      type="button"
      class="transport"
      :disabled="!canPlay"
      :aria-label="isPadPlaying ? 'Pause' : 'Play'"
      @click="audio.toggle(PAD_PLAYBACK)"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path v-if="isPadPlaying" d="M4 3h3v10H4zm5 0h3v10H9z" />
        <path v-else d="M5 3l8 5-8 5z" />
      </svg>
    </button>

    <div class="heading">
      <span class="source-name" :class="{ empty: !canPlay }">{{ title }}</span>
      <p class="details">
        <span v-for="(part, index) in details" :key="part" class="detail">
          <span v-if="index > 0" class="separator" aria-hidden="true">·</span>{{ part }}
        </span>
      </p>
    </div>

    <span v-if="syncState" class="sync-state" :class="syncState">
      <span class="dot" aria-hidden="true" />
      {{ syncState === 'unsynced' ? 'Unsynced' : 'Synced' }}
    </span>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex: 0 0 auto;
  gap: 0.875rem;
  align-items: center;
  min-height: var(--bar-height);
  padding: 0.375rem 1rem;
  background: var(--panel-surface);
  border-bottom: 1px solid var(--panel-border);
}

.transport {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: #fff;
  cursor: pointer;
  background: var(--accent);
  border: 0;
  border-radius: var(--radius-md);
}

.transport:hover:not(:disabled) {
  background: var(--accent-strong);
}

.transport:disabled {
  color: var(--text-subtle);
  cursor: default;
  background: var(--control-track);
}

.transport:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

svg {
  width: 13px;
  height: 13px;
  fill: currentcolor;
}

.heading {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.0625rem;
  min-width: 0;
}

.source-name {
  overflow: hidden;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-name.empty {
  color: var(--text-muted);
  font-weight: 500;
}

.details {
  overflow: hidden;
  margin: 0;
  font-size: 0.6875rem;
  line-height: 1.35;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.separator {
  margin: 0 0.375rem;
  color: var(--text-subtle);
}

.sync-state {
  display: flex;
  flex: 0 0 auto;
  gap: 0.4375rem;
  align-items: center;
  padding: 0.3125rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: var(--radius-pill);
}

.sync-state.unsynced {
  color: var(--status-unsynced);
  background: var(--status-unsynced-soft);
}

.sync-state.synced {
  color: var(--status-synced);
  background: var(--status-synced-soft);
}

.dot {
  width: 7px;
  height: 7px;
  background: currentcolor;
  border-radius: 50%;
}
</style>

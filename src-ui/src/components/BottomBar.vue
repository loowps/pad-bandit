<script setup lang="ts">
import { computed } from 'vue'
import { useCardStore } from '@/stores/card'
import { usePadsStore } from '@/stores/pads'
import { useProjectsStore } from '@/stores/projects'
import { useSyncStore } from '@/stores/sync'

const card = useCardStore()
const pads = usePadsStore()
const projects = useProjectsStore()
const sync = useSyncStore()

const pendingLabel = computed(() => {
  const count = pads.plan.length
  return count === 1 ? '1 pad changed' : `${count} pads changed`
})

const portabilityLabel = computed(() => {
  const { fromDisk, fromCard } = projects.portability
  return `${fromDisk} from disc (portable) · ${fromCard} from card`
})

const orphanLabel = computed(() => {
  const count = projects.orphans.length
  return count === 1 ? '1 saved pad lost its source' : `${count} saved pads lost their source`
})

const showsPortability = computed(() => projects.isNamed || pads.hasPreparedPads)

const presenceLabel = computed(() => {
  if (card.presence === 'missing') {
    return 'Card removed — the plan cannot be applied'
  }
  if (card.presence === 'stale') {
    return 'The card changed since it was read'
  }
  return ''
})
</script>

<template>
  <footer class="bottom-bar">
    <button type="button" class="pick" @click="card.pickCard()">Choose card folder…</button>

    <span v-if="card.status === 'empty'" class="status is-muted">No card folder selected</span>
    <span v-else-if="card.status === 'reading'" class="status is-muted">Reading card…</span>
    <template v-else>
      <span class="path" :title="card.path">{{ card.path }}</span>
      <span class="status" :class="card.isValid ? 'is-valid' : 'is-invalid'">
        {{ card.isValid ? 'Card folder recognised' : card.error }}
      </span>
    </template>

    <div class="actions">
      <span v-if="presenceLabel" class="orphans">{{ presenceLabel }}</span>
      <span v-else-if="projects.hasOrphans" class="orphans" :title="orphanLabel">{{
        orphanLabel
      }}</span>
      <span v-else-if="projects.error" class="orphans">{{ projects.error }}</span>
      <span v-else-if="showsPortability" class="portability">{{ portabilityLabel }}</span>
      <span v-if="pads.hasPreparedPads" class="pending">{{ pendingLabel }}</span>
      <button
        v-if="pads.hasPreparedPads"
        type="button"
        class="clear"
        @click="pads.discardChanges()"
      >
        Discard changes
      </button>
      <button v-if="card.status !== 'empty'" type="button" class="clear" @click="card.clear()">
        Clear
      </button>
      <button
        type="button"
        class="sync"
        :disabled="!pads.hasPreparedPads || card.presence !== 'present'"
        @click="sync.open()"
      >
        Sync…
      </button>
    </div>
  </footer>
</template>

<style scoped>
.bottom-bar {
  display: flex;
  flex: 0 0 auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: var(--panel-surface);
  border-top: 1px solid var(--panel-border);
}

.pick,
.clear,
.sync {
  flex: 0 0 auto;
  padding: 0.25rem 0.625rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-default);
  cursor: pointer;
  background: var(--panel-surface);
  border: 1px solid var(--control-border);
  border-radius: 3px;
}

.pick:hover:not(:disabled),
.clear:hover {
  border-color: var(--accent);
}

.pick:disabled,
.sync:disabled {
  color: var(--text-muted);
  cursor: default;
  opacity: 0.6;
}

.pick:focus-visible,
.clear:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.path {
  overflow: hidden;
  font-size: 0.8125rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status {
  overflow: hidden;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status.is-muted {
  color: var(--text-muted);
}

.status.is-valid {
  color: #1f7a4d;
}

.status.is-invalid {
  color: #b4441f;
}

.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-left: auto;
}

.pending {
  font-size: 0.75rem;
  white-space: nowrap;
}

.portability,
.orphans {
  overflow: hidden;
  max-width: 22rem;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portability {
  color: var(--text-muted);
}

.orphans {
  color: #b4441f;
}
</style>

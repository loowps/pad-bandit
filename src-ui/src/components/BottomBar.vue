<script setup lang="ts">
import { computed } from 'vue'
import { useCardStore } from '@/stores/card'
import { usePadsStore } from '@/stores/pads'
import { useProjectsStore } from '@/stores/projects'
import { useSyncStore } from '@/stores/sync'
import type { PadChangeStatus } from '@/domain/plan'

const WORK_LABELS: Record<PadChangeStatus, string> = {
  added: 'to copy',
  replaced: 'to replace',
  removed: 'to remove',
  moved: 'to move',
  settings: 'to retune',
}

const ORDERED_STATUSES: PadChangeStatus[] = ['added', 'replaced', 'removed', 'moved', 'settings']

const card = useCardStore()
const pads = usePadsStore()
const projects = useProjectsStore()
const sync = useSyncStore()

const work = computed(() =>
  ORDERED_STATUSES.map((status) => ({
    status,
    label: WORK_LABELS[status],
    count: pads.plan.filter((change) => change.status === status).length,
  })).filter((entry) => entry.count > 0),
)

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
    <button v-if="card.status === 'empty'" type="button" class="pick" @click="card.pickCard()">
      Choose card folder…
    </button>
    <span v-if="card.status === 'empty'" class="status is-muted">No card folder selected</span>

    <template v-else-if="card.status === 'reading'">
      <span class="status is-muted">Reading card…</span>
    </template>

    <template v-else>
      <button
        type="button"
        class="card-chip"
        aria-label="Change card folder…"
        :title="card.rootPath ?? ''"
        :disabled="sync.running"
        @click="card.pickCard()"
      >
        <span class="presence" :class="card.presence" aria-hidden="true" />
        <span class="path">{{ card.path }}</span>
      </button>
      <span class="status" :class="card.isValid ? 'is-valid' : 'is-invalid'">
        {{
          sync.running ? 'Writing to card…' : card.isValid ? 'Card folder recognised' : card.error
        }}
      </span>
      <button
        type="button"
        class="clear"
        aria-label="Forget card folder"
        :disabled="sync.running"
        @click="card.clear()"
      >
        ✕
      </button>
    </template>

    <ul v-if="work.length > 0" class="plan-summary">
      <li v-for="entry in work" :key="entry.status" class="work">
        <b>{{ entry.count }}</b> {{ entry.label }}
      </li>
    </ul>

    <div class="actions">
      <span v-if="presenceLabel" class="orphans">{{ presenceLabel }}</span>
      <span v-else-if="projects.hasOrphans" class="orphans" :title="orphanLabel">{{
        orphanLabel
      }}</span>
      <span v-else-if="projects.error" class="orphans">{{ projects.error }}</span>
      <span v-else-if="showsPortability" class="portability">{{ portabilityLabel }}</span>
      <button
        v-if="pads.hasPreparedPads"
        type="button"
        class="discard"
        @click="pads.discardChanges()"
      >
        Discard changes
      </button>
      <button
        type="button"
        class="sync"
        :disabled="!pads.hasPreparedPads || card.presence !== 'present' || sync.running"
        @click="sync.open()"
      >
        Sync to card
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
  padding: 0.5rem 1rem;
  background: var(--panel-surface);
  border-top: 1px solid var(--panel-border);
}

.pick,
.discard,
.clear,
.sync {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  height: var(--control-height);
  padding: 0 0.75rem;
  font: inherit;
  font-size: 0.75rem;
  line-height: 1;
  color: var(--text-default);
  cursor: pointer;
  background: var(--control-surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-md);
}

.clear {
  justify-content: center;
  width: var(--control-height);
  padding: 0;
  color: var(--text-muted);
  border: 0;
}

.pick:hover,
.discard:hover,
.clear:hover:not(:disabled) {
  border-color: var(--text-subtle);
}

.clear:hover:not(:disabled) {
  color: var(--text-default);
  background: var(--control-track);
}

.clear:disabled,
.card-chip:disabled {
  color: var(--text-subtle);
  cursor: default;
}

.pick:focus-visible,
.discard:focus-visible,
.clear:focus-visible,
.card-chip:focus-visible,
.sync:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.card-chip {
  display: flex;
  flex: 0 0 auto;
  gap: 0.4375rem;
  align-items: center;
  height: var(--control-height);
  padding: 0 0.5rem;
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--radius-md);
}

.card-chip:hover:not(:disabled) {
  background: var(--control-track);
}

.presence {
  width: 8px;
  height: 8px;
  background: var(--text-subtle);
  border-radius: 50%;
}

.presence.present {
  background: var(--status-synced);
}

.presence.stale {
  background: var(--status-unsynced);
}

.presence.missing {
  background: var(--status-danger);
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
  color: var(--status-synced);
}

.status.is-invalid {
  color: var(--status-danger);
}

.plan-summary {
  display: flex;
  flex: 0 0 auto;
  gap: 0.875rem;
  align-items: center;
  padding: 0;
  padding-left: 0.75rem;
  margin: 0;
  list-style: none;
  border-left: 1px solid var(--panel-border);
}

.work {
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.work b {
  font-variant-numeric: tabular-nums;
  color: var(--status-unsynced);
}

.actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-left: auto;
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
  color: var(--status-danger);
}

.sync {
  padding: 0 1rem;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
}

.sync:hover:not(:disabled) {
  background: var(--accent-strong);
}

.sync:disabled {
  color: var(--text-subtle);
  cursor: default;
  background: var(--control-track);
  border-color: var(--control-border);
}
</style>

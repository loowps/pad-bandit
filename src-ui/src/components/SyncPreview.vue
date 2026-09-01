<script setup lang="ts">
import { computed } from 'vue'
import { useSyncStore } from '@/stores/sync'
import { padIdForSlot } from '@/domain/pad'
import type { Problem } from '@/sync'

const sync = useSyncStore()

const summary = computed(() => {
  const report = sync.report
  if (!report) {
    return ''
  }
  return `${megabytes(report.bytesToWrite)} to write · ${megabytes(report.bytesToFree)} freed · ${megabytes(report.freeSpace)} free on the card`
})

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

const progressText = computed(() => {
  const current = sync.progress
  if (!current) {
    return 'Starting…'
  }
  const pad = current.slot === null ? '' : ` — pad ${padIdForSlot(current.slot)}`
  return `${current.phase}${pad} · ${current.slotsDone} of ${current.slotsTotal}`
})

const outcomeText = computed(() => {
  const done = sync.outcome
  if (!done) {
    return ''
  }
  const parts = [`${done.applied.length} pad${done.applied.length === 1 ? '' : 's'} written`]
  if (done.failures.length) {
    parts.push(`${done.failures.length} failed`)
  }
  if (done.cancelled) {
    parts.push(`cancelled, ${done.skipped.length} skipped`)
  }
  if (!done.verified) {
    parts.push('the card did not read back as expected')
  }
  return parts.join(' · ')
})

function problemText(problem: Problem): string {
  switch (problem.kind) {
    case 'cardChanged':
      return 'The card changed since this plan was built. Read it again before syncing.'
    case 'notEnoughRoom':
      return `Needs ${megabytes(problem.needed)} but only ${megabytes(problem.available)} is free.`
    case 'sourceUnreadable':
      return `${problem.source} — ${problem.reason}`
    case 'sampleTooLong':
      return `${megabytes(problem.bytes)} is over the ${megabytes(problem.cap)} limit for one pad.`
    case 'nothingAtOriginSlot':
      return 'The pad it moves from is empty.'
    case 'unknownSlot':
      return 'That pad is not on the card.'
  }
}
</script>

<template>
  <div v-if="sync.isOpen" class="scrim" @click.self="sync.close()">
    <section class="preview" role="dialog" aria-label="Sync preview">
      <header>
        <h2>Sync to card</h2>
        <button type="button" class="action" @click="sync.close()">Close</button>
      </header>

      <p v-if="sync.checking" class="note">Checking the card…</p>
      <p v-else-if="sync.error" class="note is-bad">{{ sync.error }}</p>
      <p v-else-if="summary" class="note">{{ summary }}</p>

      <ul v-if="sync.blockers.length" class="blockers">
        <li v-for="(problem, index) in sync.blockers" :key="index">{{ problemText(problem) }}</li>
      </ul>

      <p v-if="!sync.rows.length" class="note">Nothing has changed since the card was read.</p>

      <ol v-else class="rows">
        <li
          v-for="row in sync.rows"
          :key="row.padId"
          :class="{ off: sync.deselected.has(row.padId) }"
        >
          <label>
            <input
              type="checkbox"
              :checked="!sync.deselected.has(row.padId)"
              @change="sync.toggle(row.padId)"
            />
            <span class="pad">{{ row.padId }}</span>
            <span class="headline">{{ row.headline }}</span>
            <span class="detail">{{ row.detail }}</span>
          </label>
          <p
            v-for="(problem, index) in sync.problemsBySlot.get(row.slot) ?? []"
            :key="index"
            class="row-problem"
          >
            {{ problemText(problem) }}
          </p>
        </li>
      </ol>

      <div v-if="sync.running" class="running">
        <div class="bar"><span :style="{ width: `${sync.percent}%` }" /></div>
        <p class="note">{{ progressText }}</p>
      </div>

      <p v-else-if="sync.outcome" class="note" :class="{ 'is-bad': !sync.outcome.verified }">
        {{ outcomeText }}
      </p>

      <footer>
        <button type="button" class="action" :disabled="sync.running" @click="sync.selectAll()">
          Select all
        </button>
        <button
          type="button"
          class="action"
          :disabled="sync.checking || sync.running"
          @click="sync.check()"
        >
          Re-check
        </button>
        <button v-if="sync.running" type="button" class="action" @click="sync.cancel()">
          Cancel
        </button>
        <button
          v-else
          type="button"
          class="action primary"
          :disabled="!sync.canSync"
          @click="sync.run()"
        >
          Sync
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 45%);
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  width: min(46rem, 92vw);
  max-height: 80vh;
  padding: 0.875rem;
  background: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: 6px;
}

header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

h2 {
  flex: 1 1 auto;
  margin: 0;
  font-size: 0.9375rem;
}

.note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.note.is-bad {
  color: var(--status-danger);
}

.blockers {
  margin: 0;
  padding-left: 1.125rem;
  font-size: 0.75rem;
  color: var(--status-danger);
}

.rows {
  overflow-y: auto;
  flex: 1 1 auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rows li {
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--panel-border);
}

.rows li.off {
  opacity: 0.45;
}

label {
  display: grid;
  grid-template-columns: auto 3rem 7rem 1fr;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.75rem;
  cursor: pointer;
}

.pad {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.headline {
  color: var(--text-muted);
}

.detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-problem {
  margin: 0.125rem 0 0.25rem 5.5rem;
  font-size: 0.6875rem;
  color: var(--status-danger);
}

footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.action {
  padding: 0.25rem 0.625rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-default);
  cursor: pointer;
  background: var(--panel-surface);
  border: 1px solid var(--control-border);
  border-radius: 3px;
}

.action:hover:not(:disabled) {
  border-color: var(--accent);
}

.action:disabled {
  color: var(--text-muted);
  cursor: default;
  opacity: 0.6;
}

.action:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.action.primary:not(:disabled) {
  font-weight: 600;
  border-color: var(--accent);
}

.running {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.bar {
  overflow: hidden;
  height: 4px;
  background: var(--control-border);
  border-radius: 2px;
}

.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 120ms linear;
}
</style>

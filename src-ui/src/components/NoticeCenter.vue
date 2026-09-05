<script setup lang="ts">
import { computed, ref } from 'vue'
import { onClickOutside, onKeyStroke, useTimestamp } from '@vueuse/core'
import { useNoticesStore } from '@/stores/notices'
import { elapsedLabel } from '@/domain/notices'

const REFRESH_MS = 30_000

const notices = useNoticesStore()
const panel = ref<HTMLElement | null>(null)
const trigger = ref<HTMLElement | null>(null)
const now = useTimestamp({ interval: REFRESH_MS })

const label = computed(() => (notices.unseen > 0 ? String(notices.unseen) : String(notices.count)))

const triggerLabel = computed(() =>
  notices.unseen > 0
    ? `${notices.unseen} new ${plural(notices.unseen)}`
    : `${notices.count} ${plural(notices.count)}`,
)

function plural(count: number): string {
  return count === 1 ? 'message' : 'messages'
}

onClickOutside(panel, () => notices.close(), { ignore: [trigger] })
onKeyStroke('Escape', () => notices.close())
</script>

<template>
  <div v-if="notices.count > 0" class="centre">
    <button
      ref="trigger"
      type="button"
      class="trigger"
      :class="[notices.worst, { 'is-unseen': notices.unseen > 0 }]"
      :aria-expanded="notices.isOpen"
      :aria-label="triggerLabel"
      :title="triggerLabel"
      @click="notices.toggle()"
    >
      <span class="mark" aria-hidden="true" />
      {{ label }}
    </button>

    <section v-if="notices.isOpen" ref="panel" class="panel" aria-label="Messages">
      <header>
        <h2>Messages</h2>
        <button type="button" class="plain" @click="notices.clear()">Clear all</button>
      </header>

      <ol>
        <li v-for="entry in notices.entries" :key="entry.id" :class="entry.severity">
          <span class="mark" aria-hidden="true" />
          <div class="body">
            <p class="title">{{ entry.title }}</p>
            <p v-if="entry.detail" class="detail">{{ entry.detail }}</p>
            <p class="when">{{ elapsedLabel(entry.at, now) }}</p>
          </div>
          <button
            v-if="entry.action"
            type="button"
            class="plain is-action"
            @click="entry.action?.run()"
          >
            {{ entry.action.label }}
          </button>
          <button
            type="button"
            class="remove"
            aria-label="Remove message"
            @click="notices.dismiss(entry.id)"
          >
            ✕
          </button>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.centre {
  position: relative;
  display: flex;
  flex: 0 0 auto;
}

.trigger {
  display: inline-flex;
  gap: 0.375rem;
  align-items: center;
  height: var(--control-height);
  padding: 0 0.5rem;
  font: inherit;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--control-border);
  border-radius: var(--radius-pill);
}

.trigger:hover,
.trigger[aria-expanded='true'] {
  color: var(--text-default);
  background: var(--control-track);
}

.trigger.is-unseen {
  color: var(--text-default);
  border-color: var(--notice-unread);
}

.trigger:focus-visible,
.plain:focus-visible,
.remove:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.mark {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  background: var(--text-subtle);
  border-radius: 50%;
}

.info .mark,
.trigger.info .mark {
  background: var(--notice-info);
}

.warning .mark,
.trigger.warning .mark {
  background: var(--notice-warning);
}

.error .mark,
.trigger.error .mark {
  background: var(--notice-error);
}

.panel {
  position: absolute;
  right: 0;
  bottom: calc(var(--control-height) + 0.5rem);
  z-index: 21;
  display: flex;
  flex-direction: column;
  width: min(28rem, calc(100vw - 2rem));
  max-height: min(60vh, 26rem);
  background: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
}

header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.625rem;
  border-bottom: 1px solid var(--panel-border);
}

h2 {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

ol {
  flex: 1 1 auto;
  padding: 0.25rem;
  margin: 0;
  overflow-y: auto;
  list-style: none;
}

li {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.375rem 0.375rem 0.375rem 0.5rem;
  border-radius: var(--radius-sm);
}

li:hover {
  background: var(--control-track);
}

li .mark {
  margin-top: 0.3125rem;
}

.body {
  flex: 1 1 auto;
  min-width: 0;
}

.title {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.3;
}

.detail {
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.when {
  margin: 0.125rem 0 0;
  font-size: 0.6875rem;
  color: var(--text-subtle);
}

.plain {
  flex: 0 0 auto;
  padding: 0;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-muted);
  cursor: pointer;
  background: transparent;
  border: 0;
}

.plain:hover {
  color: var(--text-default);
}

.plain.is-action {
  font-weight: 600;
  color: var(--accent);
}

.plain.is-action:hover {
  color: var(--accent-strong);
}

.remove {
  flex: 0 0 auto;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  font: inherit;
  font-size: 0.75rem;
  line-height: 1;
  color: var(--text-subtle);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
}

.remove:hover {
  color: var(--text-default);
}
</style>

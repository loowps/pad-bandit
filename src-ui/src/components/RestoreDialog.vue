<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import { useDialog } from '@/composables/useDialog'
import { divergedPads } from '@/domain/project'

const projects = useProjectsStore()
const surface = ref<HTMLElement | null>(null)
const clearExtras = ref(false)

watch(
  () => projects.restoreOffer,
  () => {
    clearExtras.value = false
  },
)

function pads(count: number): string {
  return `${count} ${count === 1 ? 'pad' : 'pads'}`
}

const headline = computed(() => {
  const offer = projects.restoreOffer
  if (!offer) {
    return ''
  }
  const named = offer.name ? `“${offer.name}”` : 'the project'
  return `The card doesn't match ${named} on ${pads(divergedPads(offer.divergence))}.`
})

const findings = computed(() => {
  const divergence = projects.restoreOffer?.divergence
  if (!divergence) {
    return []
  }
  return [
    { count: divergence.onCard, text: 'still on the card, on another pad' },
    { count: divergence.fromDisk, text: 'from the original file on your computer' },
    { count: divergence.missing, text: "can't be found anywhere" },
  ]
    .filter((finding) => finding.count > 0)
    .map((finding) => `${pads(finding.count)} ${finding.text}`)
})

const extra = computed(() => projects.restoreOffer?.divergence.extra ?? 0)

function answer(restore: boolean): void {
  projects.answerRestore({ restore, clearExtras: restore && clearExtras.value })
}

useDialog(surface, () => answer(false))
</script>

<template>
  <div v-if="projects.restoreOffer" class="scrim">
    <section
      ref="surface"
      class="restore"
      role="alertdialog"
      aria-modal="true"
      aria-label="Restore from project"
    >
      <p class="headline">{{ headline }}</p>
      <ul v-if="findings.length" class="findings">
        <li v-for="finding in findings" :key="finding">{{ finding }}</li>
      </ul>
      <label v-if="extra > 0" class="extra">
        <input v-model="clearExtras" type="checkbox" />
        <span>
          Also clear {{ pads(extra) }} that {{ extra === 1 ? 'is' : 'are' }} empty in the project
        </span>
      </label>
      <footer>
        <button type="button" class="action is-primary" @click="answer(true)">
          Restore from project
        </button>
        <button type="button" class="action" @click="answer(false)">Keep what's on the card</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: var(--wave-shade);
}

.restore {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  width: min(30rem, 92vw);
  padding: 1rem;
  font-size: 0.8125rem;
  background: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
}

.headline {
  margin: 0;
  font-weight: 600;
}

.findings {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-left: 1.125rem;
  margin: 0;
  color: var(--text-muted);
}

.extra {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  cursor: pointer;
}

footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.25rem;
}

.action {
  padding: 0.25rem 0.625rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-default);
  cursor: pointer;
  background: var(--panel-surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-sm);
}

.action:hover {
  border-color: var(--accent);
}

.action:focus-visible,
.extra input:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.action.is-primary {
  font-weight: 600;
  color: var(--on-accent);
  background: var(--accent);
  border-color: var(--accent);
}

.action.is-primary:hover {
  background: var(--accent-strong);
}
</style>

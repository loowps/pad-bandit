<script setup lang="ts">
import { computed } from 'vue'
import { useNoticesStore } from '@/stores/notices'

const notices = useNoticesStore()

const onScreen = computed(() => (notices.isOpen ? [] : notices.toasts))
</script>

<template>
  <div class="toasts" role="status" aria-live="polite" aria-label="Recent messages">
    <TransitionGroup name="toast">
      <article
        v-for="toast in onScreen"
        :key="toast.id"
        class="toast"
        :class="toast.severity"
        @mouseenter="notices.holdToasts()"
        @mouseleave="notices.releaseToasts()"
        @focusin="notices.holdToasts()"
        @focusout="notices.releaseToasts()"
      >
        <span class="mark" aria-hidden="true" />
        <div class="body">
          <p class="title">{{ toast.title }}</p>
          <p v-if="toast.detail" class="detail">{{ toast.detail }}</p>
        </div>
        <button v-if="toast.action" type="button" class="act" @click="toast.action?.run()">
          {{ toast.action.label }}
        </button>
        <button
          type="button"
          class="hide"
          aria-label="Hide message"
          @click="notices.hide(toast.id)"
        >
          ✕
        </button>
      </article>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 1rem;
  bottom: calc(var(--bar-height) + 0.5rem);
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(26rem, calc(100vw - 2rem));
  pointer-events: none;
}

.toast {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.5rem 0.5rem 0.5rem 0.625rem;
  pointer-events: auto;
  background: var(--panel-surface);
  border: 1px solid var(--panel-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
}

.mark {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  margin-top: 0.3125rem;
  background: var(--notice-info);
  border-radius: 50%;
}

.toast.warning .mark {
  background: var(--notice-warning);
}

.toast.error .mark {
  background: var(--notice-error);
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
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.act {
  flex: 0 0 auto;
  padding: 0.125rem 0.375rem;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
  background: transparent;
  border: 0;
}

.act:hover {
  color: var(--accent-strong);
}

.hide {
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

.hide:hover {
  color: var(--text-default);
  background: var(--control-track);
}

.act:focus-visible,
.hide:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(0.75rem);
}

.toast-move {
  transition: transform 140ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active,
  .toast-move {
    transition: none;
  }
}
</style>

<script setup lang="ts">
import AppToolbar from '@/components/AppToolbar.vue'
import BankGrid from '@/components/BankGrid.vue'
import BottomBar from '@/components/BottomBar.vue'
import FileBrowser from '@/components/FileBrowser.vue'
import PaneDivider from '@/components/PaneDivider.vue'
import PadParameters from '@/components/PadParameters.vue'
import PadWaveform from '@/components/PadWaveform.vue'
import ReconciliationBanner from '@/components/ReconciliationBanner.vue'
import RecoveryBanner from '@/components/RecoveryBanner.vue'
import SyncPreview from '@/components/SyncPreview.vue'
import { onMounted, onUnmounted } from 'vue'
import { useCardStore } from '@/stores/card'
import { useFileBrowserStore } from '@/stores/fileBrowser'
import { useProjectsStore } from '@/stores/projects'
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useUiStore,
} from '@/stores/ui'

const ui = useUiStore()
const browser = useFileBrowserStore()
const card = useCardStore()
const projects = useProjectsStore()

onMounted(async () => {
  await Promise.all([browser.restore(), card.restore()])
  await Promise.all([projects.refresh(), projects.offerRecovery(), projects.listenToMenu()])
  projects.startJournal()
  card.watchPresence()
})

onUnmounted(() => {
  projects.stopJournal()
  card.stopWatching()
})
</script>

<template>
  <div class="editor">
    <RecoveryBanner />
    <ReconciliationBanner />
    <AppToolbar />
    <main class="editor-body">
      <FileBrowser class="editor-sidebar" :style="{ width: ui.sidebarWidth + 'px' }" />
      <PaneDivider
        :size="ui.sidebarWidth"
        :min="SIDEBAR_MIN_WIDTH"
        :max="SIDEBAR_MAX_WIDTH"
        :reset-to="SIDEBAR_DEFAULT_WIDTH"
        label="Resize audio folders panel"
        @resize="ui.setSidebarWidth"
      />
      <div class="work-area">
        <PadWaveform class="editor-waveform" />
        <PadParameters />
        <div class="pad-area">
          <BankGrid />
        </div>
      </div>
    </main>
    <BottomBar />
    <SyncPreview />
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.editor-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.editor-sidebar {
  flex: 0 0 auto;
}

.work-area {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.editor-waveform {
  flex: 0 0 13rem;
}

.pad-area {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>

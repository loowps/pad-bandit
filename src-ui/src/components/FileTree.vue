<script setup lang="ts">
import { computed } from 'vue'
import { useVirtualList } from '@vueuse/core'
import FileTreeRow from '@/components/FileTreeRow.vue'
import { useFileBrowserStore } from '@/stores/fileBrowser'

const ROW_HEIGHT = 24

const browser = useFileBrowserStore()

const rows = computed(() => browser.visibleRows)

const { list, containerProps, wrapperProps } = useVirtualList(rows, {
  itemHeight: ROW_HEIGHT,
  overscan: 12,
})
</script>

<template>
  <div v-bind="containerProps" class="tree">
    <div v-bind="wrapperProps">
      <FileTreeRow v-for="item in list" :key="item.data.node.path" :row="item.data" />
    </div>
  </div>
</template>

<style scoped>
.tree {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0.25rem;
}
</style>

import { onScopeDispose, ref, type Ref, shallowRef, watch } from 'vue'
import { refDebounced } from '@vueuse/core'
import { onExactPeaks, type Peaks, requestPeaks } from '@/audio'

const COLUMN_DEBOUNCE_MS = 120

export function useWaveformPeaks(path: Ref<string | null>, columns: Ref<number>) {
  const peaks = shallowRef<Peaks | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const settledColumns = refDebounced(columns, COLUMN_DEBOUNCE_MS)

  let requestToken = 0
  let loadedPath: string | null = null

  async function load(): Promise<void> {
    const wanted = path.value
    const wantedColumns = Math.round(settledColumns.value)

    if (!wanted) {
      requestToken += 1
      loadedPath = null
      peaks.value = null
      error.value = null
      isLoading.value = false
      return
    }

    if (wanted !== loadedPath) {
      loadedPath = wanted
      peaks.value = null
      error.value = null
    }

    isLoading.value = true

    if (wantedColumns < 1) {
      return
    }

    const token = ++requestToken
    try {
      const next = await requestPeaks(wanted, wantedColumns)
      if (token === requestToken) {
        peaks.value = next
        error.value = null
      }
    } catch (cause) {
      if (token === requestToken) {
        peaks.value = null
        error.value = cause instanceof Error ? cause.message : String(cause)
      }
    } finally {
      if (token === requestToken) {
        isLoading.value = false
      }
    }
  }

  watch([path, settledColumns], () => void load(), { immediate: true })

  let unlisten: (() => void) | null = null
  void onExactPeaks((payload) => {
    if (payload.path === path.value && payload.peaks.columns === peaks.value?.columns) {
      peaks.value = payload.peaks
    }
  })
    .then((stop) => {
      unlisten = stop
    })
    .catch(() => {
      unlisten = null
    })

  onScopeDispose(() => {
    requestToken += 1
    unlisten?.()
  })

  return { peaks, isLoading, error }
}

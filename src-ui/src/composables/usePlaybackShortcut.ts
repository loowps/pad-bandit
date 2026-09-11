import { useEventListener } from '@vueuse/core'
import { textFieldAt } from '@/composables/browserChrome'
import { openMenu } from '@/composables/useContextMenu'
import { aDialogIsOpen } from '@/composables/useDialog'
import { PAD_PLAYBACK, useAudioStore } from '@/stores/audio'

function takesSpace(target: EventTarget | null): boolean {
  const field = textFieldAt(target)
  if (field) {
    return !(field instanceof HTMLInputElement && field.readOnly)
  }
  return target instanceof HTMLInputElement && target.type === 'checkbox'
}

export function usePlaybackShortcut(): void {
  const audio = useAudioStore()

  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    const withModifier = event.ctrlKey || event.altKey || event.metaKey
    if (
      event.code !== 'Space' ||
      event.repeat ||
      withModifier ||
      aDialogIsOpen.value ||
      openMenu.value ||
      takesSpace(event.target)
    ) {
      return
    }
    event.preventDefault()
    audio.toggle(audio.source ?? PAD_PLAYBACK)
  })
}

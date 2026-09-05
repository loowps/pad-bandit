interface BackendError {
  code: string
  message: string
}

const COPY: Record<string, string> = {
  outsideWritableScope: 'Pad Bandit only writes inside the card folder.',
  outsideReadableScope: 'That file is outside the folders you added.',
  ungrantedFile: 'That file was not chosen in a dialog, so it cannot be opened.',
  unresolvablePath: 'That path could not be found.',
  notADirectory: 'That is a file, not a folder.',
  notACard: 'That folder holds no pad data.',
  padInfoTooShort: 'The pad data on that card is damaged.',
  unknownSlot: 'That pad is not on the card.',
  noCardSelected: 'No card folder is selected.',
  cardChanged: 'The card changed since it was read. Read it again.',
  syncInProgress: 'A sync is already running.',
  unknownFolder: 'That folder is no longer in the list.',
  unnamedProject: 'A project needs a name.',
  unsupportedProjectVersion: 'That project was made by a newer version of Pad Bandit.',
}

export const CODES_WITH_COPY = Object.keys(COPY)

export function explain(cause: unknown, fallback: string): string {
  if (isBackendError(cause)) {
    return COPY[cause.code] ?? (cause.message || fallback)
  }
  if (cause instanceof Error) {
    return cause.message || fallback
  }
  return typeof cause === 'string' && cause ? cause : fallback
}

function isBackendError(cause: unknown): cause is BackendError {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    typeof (cause as BackendError).code === 'string' &&
    typeof (cause as BackendError).message === 'string'
  )
}

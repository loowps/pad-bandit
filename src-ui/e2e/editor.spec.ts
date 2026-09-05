import { test, expect, type Page } from '@playwright/test'
import {
  backendCalls,
  cardWithFilledSlots,
  chooseFromMenu,
  setEntries,
  stubBackend,
  STUB_PROJECT_PATH,
  type StubEntry,
} from './stubBackend'

const DECODABLE = ['wav', 'aif', 'aiff', 'mp3', 'flac', 'ogg']

function entry(path: string, isDir: boolean, ext: string | null = null): StubEntry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    isDir,
    isAudio: ext !== null && DECODABLE.includes(ext),
  }
}

const samples: Record<string, StubEntry[]> = {
  '/samples': [entry('/samples/drums', true), entry('/samples/kick.wav', false, 'wav')],
  '/samples/drums': [entry('/samples/drums/snare.wav', false, 'wav')],
}

test.beforeEach(async ({ page }) => {
  await stubBackend(page, {
    pickedFolder: '/samples',
    entries: samples,
    card: cardWithFilledSlots('/samples', 3),
  })
  await page.goto('/')
})

test('renders every bank and pad', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /^Bank [A-J]$/ })).toHaveCount(10)
  await expect(page.getByRole('button', { name: /^Pad [A-J]\d+$/ })).toHaveCount(120)
})

test('starts with no pad selected and nothing to play', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Selected pad' })).toContainText('No pad selected')
  await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Clear pad' })).toBeDisabled()
})

test('selecting a pad names it in the toolbar', async ({ page }) => {
  await page.getByRole('button', { name: 'Pad C4', exact: true }).click()

  const toolbar = page.getByRole('region', { name: 'Selected pad' })
  await expect(toolbar).toContainText('C4')
  await expect(toolbar).toContainText('No audio source')
})

test('reads the saved folders on startup', async ({ page }) => {
  await expect
    .poll(async () => (await backendCalls(page)).map((call) => call.command))
    .toContain('config_get')
})

test('adds a folder through the picker and browses into it', async ({ page }) => {
  await page.getByRole('button', { name: 'Add audio folder' }).click()

  await expect(page.getByRole('treeitem', { name: 'drums' })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeVisible()

  const commands = (await backendCalls(page)).map((call) => call.command)
  expect(commands).toContain('pick_folder')
  expect(commands).toContain('config_add_folder')

  await page.getByRole('treeitem', { name: 'drums' }).click()
  await expect(page.getByRole('treeitem', { name: 'snare.wav' })).toBeVisible()
})

test('removes a folder again', async ({ page }) => {
  await page.getByRole('button', { name: 'Add audio folder' }).click()
  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeVisible()

  await page.getByRole('button', { name: 'Remove samples' }).click()

  await expect(page.getByText('Add a folder of samples to browse it here.')).toBeVisible()
  expect((await backendCalls(page)).map((call) => call.command)).toContain('config_remove_folder')
})

test('stores a chosen card folder and fills its pads', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose card folder…' }).click()

  await expect(page.getByText('Card folder recognised')).toBeVisible()
  const call = (await backendCalls(page)).find((each) => each.command === 'config_set_card_path')
  expect(call?.args).toEqual({ path: '/samples' })

  await page.getByRole('button', { name: 'Pad A1', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Selected pad' })).toContainText('sample0.wav')
})

test('reports a folder that holds no pad data', async ({ page }) => {
  await stubBackend(page, { pickedFolder: '/holiday-photos', card: null })
  await page.reload()

  await page.getByRole('button', { name: 'Choose card folder…' }).click()

  await expect(page.getByText('no pad data on that card')).toBeVisible()
})

test('saves the pending work as a project and reopens it', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose card folder…' }).click()
  await expect(page.getByText('Card folder recognised')).toBeVisible()

  await page.getByRole('button', { name: 'Pad A1', exact: true }).click()
  await page.getByRole('button', { name: 'Clear pad' }).click()
  await expect(page.getByText('1 to remove')).toBeVisible()

  await chooseFromMenu(page, { kind: 'saveAs' })
  await expect(page.getByText('0 from disc (portable)')).toBeVisible()

  await page.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByText('1 to remove')).toBeHidden()

  await chooseFromMenu(page, { kind: 'openRecent', path: STUB_PROJECT_PATH })

  await expect(page.getByText('1 to remove')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pad A1, sample removed' })).toBeVisible()
})

test('starting a new project from the menu drops the pending work', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose card folder…' }).click()
  await expect(page.getByText('Card folder recognised')).toBeVisible()

  await page.getByRole('button', { name: 'Pad A1', exact: true }).click()
  await page.getByRole('button', { name: 'Clear pad' }).click()
  await expect(page.getByText('1 to remove')).toBeVisible()

  await chooseFromMenu(page, { kind: 'new' })

  await expect(page.getByText('1 to remove')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Pad A1, sample removed' })).toBeHidden()
})

test('shows what changed on a pad and discards it again', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose card folder…' }).click()
  await expect(page.getByText('Card folder recognised')).toBeVisible()

  await page.getByRole('button', { name: 'Pad A1', exact: true }).click()
  await page.getByRole('button', { name: 'Clear pad' }).click()

  await expect(page.getByText('1 to remove')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pad A1, sample removed' })).toBeVisible()

  await page.getByRole('button', { name: 'Discard changes' }).click()

  await expect(page.getByText('1 to remove')).toBeHidden()
  await expect(page.getByRole('region', { name: 'Selected pad' })).toContainText('sample0.wav')
})

test('dragging one bank onto another trades their pads', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose card folder…' }).click()
  await expect(page.getByText('Card folder recognised')).toBeVisible()

  await page.getByRole('button', { name: 'Pad A1', exact: true }).click()

  await page
    .getByRole('heading', { name: 'Bank A' })
    .dragTo(page.getByRole('heading', { name: 'Bank B' }))

  await expect(page.getByRole('button', { name: 'Pad B1, moved from another pad' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pad A1, sample removed' })).toBeVisible()

  const toolbar = page.getByRole('region', { name: 'Selected pad' })
  await expect(toolbar).toContainText('B1')
  await expect(toolbar).toContainText('sample0.wav')
})

test('dragging a bank back where it came from leaves nothing to sync', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose card folder…' }).click()
  await expect(page.getByText('Card folder recognised')).toBeVisible()

  const bank = (name: string) => page.getByRole('heading', { name: `Bank ${name}` })

  await bank('A').dragTo(bank('C'))
  await expect(page.getByRole('button', { name: 'Pad C1, moved from another pad' })).toBeVisible()

  await bank('C').dragTo(bank('A'))

  await expect(page.getByRole('button', { name: 'Pad C1, moved from another pad' })).toBeHidden()
  await expect(page.getByText('to remove')).toBeHidden()
})

test('the sync preview lists the pending changes and lets rows be deselected', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose card folder…' }).click()
  await expect(page.getByText('Card folder recognised')).toBeVisible()

  await page.getByRole('button', { name: 'Pad A1', exact: true }).click()
  await page.getByRole('button', { name: 'Clear pad' }).click()
  await expect(page.getByText('1 to remove')).toBeVisible()

  await page.getByRole('button', { name: 'Sync to card' }).click()

  const preview = page.getByRole('dialog', { name: 'Sync preview' })
  await expect(preview).toBeVisible()
  await expect(preview.getByText('delete sample')).toBeVisible()
  await expect(preview.getByText('to write', { exact: false })).toBeVisible()

  await preview.getByRole('checkbox').first().uncheck()
  await expect(preview.locator('li.off')).toHaveCount(1)

  await preview.getByRole('button', { name: 'Select all' }).click()
  await expect(preview.locator('li.off')).toHaveCount(0)

  await preview.getByRole('button', { name: 'Close' }).click()
  await expect(preview).toBeHidden()
})

test('syncing writes the plan and clears the pending work', async ({ page }) => {
  await page.getByRole('button', { name: 'Choose card folder…' }).click()
  await expect(page.getByText('Card folder recognised')).toBeVisible()

  await page.getByRole('button', { name: 'Pad A1', exact: true }).click()
  await page.getByRole('button', { name: 'Clear pad' }).click()
  await expect(page.getByText('1 to remove')).toBeVisible()

  await page.getByRole('button', { name: 'Sync to card' }).click()
  const preview = page.getByRole('dialog', { name: 'Sync preview' })
  await preview.getByRole('button', { name: 'Sync', exact: true }).click()

  await expect(preview.getByText('1 pad written')).toBeVisible()
  await expect(page.getByText('1 to remove')).toBeHidden()

  const call = (await backendCalls(page)).find((each) => each.command === 'sync_apply')
  expect(call).toBeDefined()
})

test('switching mode from the menu repaints the app and remembers the choice', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await chooseFromMenu(page, { kind: 'setTheme', theme: 'dark' })

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await backendCalls(page)).toContainEqual({
    command: 'config_set_theme',
    args: { theme: 'dark' },
  })
})

test('searching narrows the tree to matching samples and back again', async ({ page }) => {
  await page.getByRole('button', { name: 'Add audio folder' }).click()
  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeVisible()

  const searchBox = page.getByRole('searchbox', { name: 'Search samples' })
  await searchBox.fill('snare')

  await expect(page.getByRole('treeitem', { name: /snare\.wav/ })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeHidden()
  await expect(page.getByRole('treeitem', { name: 'drums', exact: true })).toBeHidden()

  await page.getByRole('button', { name: 'Clear search' }).click()

  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: 'drums', exact: true })).toBeVisible()
})

test('says so when nothing matches the search', async ({ page }) => {
  await page.getByRole('button', { name: 'Add audio folder' }).click()
  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search samples' }).fill('zzzz')

  await expect(page.getByText('No samples match that search.')).toBeVisible()
})

test('a one-letter search is too short and leaves the tree alone', async ({ page }) => {
  await page.getByRole('button', { name: 'Add audio folder' }).click()
  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Search samples' }).fill('k')

  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeVisible()
  expect((await backendCalls(page)).map((call) => call.command)).not.toContain('index_search')
})

test('rescanning the folders rebuilds the sample index', async ({ page }) => {
  await page.getByRole('button', { name: 'Add audio folder' }).click()
  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeVisible()

  await page.getByRole('button', { name: 'Rescan folders' }).click()

  expect((await backendCalls(page)).map((call) => call.command)).toContain('index_refresh')
})

test('offers no rescan until a folder has been added', async ({ page }) => {
  await expect(page.getByText('Add a folder of samples to browse it here.')).toBeVisible()

  await expect(page.getByRole('button', { name: 'Rescan folders' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Add audio folder' })).toBeVisible()
})

test('a rescan brings a newly added file into the open tree', async ({ page }) => {
  await page.getByRole('button', { name: 'Add audio folder' }).click()
  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: 'clap.wav' })).toBeHidden()

  await setEntries(page, '/samples', [
    entry('/samples/drums', true),
    entry('/samples/kick.wav', false, 'wav'),
    entry('/samples/clap.wav', false, 'wav'),
  ])
  await page.getByRole('button', { name: 'Rescan folders' }).click()

  await expect(page.getByRole('treeitem', { name: 'clap.wav' })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: 'kick.wav' })).toBeVisible()
})

test('a multi-file selection fills the free pads from the drop onwards', async ({ page }) => {
  await page.getByRole('button', { name: 'Add audio folder' }).click()
  await page.getByRole('treeitem', { name: 'drums' }).click()

  await page.getByRole('treeitem', { name: 'snare.wav' }).click()
  await page.getByRole('treeitem', { name: 'kick.wav' }).click({ modifiers: ['Control'] })
  await expect(page.getByText('2 files selected')).toBeVisible()

  await page
    .getByRole('treeitem', { name: 'kick.wav' })
    .dragTo(page.getByRole('button', { name: 'Pad A4', exact: true }))

  await expect(page.getByRole('button', { name: 'Pad A4, sample added' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pad A5, sample added' })).toBeVisible()
  await expect(page.getByText('Filled 2 pads')).toBeVisible()
})

test('the undo after a fill puts the pads back', async ({ page }) => {
  await page.getByRole('button', { name: 'Add audio folder' }).click()
  await page.getByRole('treeitem', { name: 'drums' }).click()

  await page.getByRole('treeitem', { name: 'snare.wav' }).click()
  await page.getByRole('treeitem', { name: 'kick.wav' }).click({ modifiers: ['Shift'] })

  await page
    .getByRole('treeitem', { name: 'kick.wav' })
    .dragTo(page.getByRole('button', { name: 'Pad A4', exact: true }))
  await expect(page.getByRole('button', { name: 'Pad A4, sample added' })).toBeVisible()

  await page.getByRole('button', { name: 'Undo' }).click()

  await expect(page.getByRole('button', { name: 'Pad A4', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pad A5', exact: true })).toBeVisible()
})

async function dropTwoOnPadA1(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Choose card folder…' }).click()
  await expect(page.getByText('Card folder recognised')).toBeVisible()
  await page.getByRole('button', { name: 'Add audio folder' }).click()
  await page.getByRole('treeitem', { name: 'drums' }).click()

  await page.getByRole('treeitem', { name: 'snare.wav' }).click()
  await page.getByRole('treeitem', { name: 'kick.wav' }).click({ modifiers: ['Control'] })

  await page
    .getByRole('treeitem', { name: 'kick.wav' })
    .dragTo(page.getByRole('button', { name: 'Pad A1', exact: true }))
}

test('a drop onto pads already in use asks before it writes', async ({ page }) => {
  await dropTwoOnPadA1(page)

  const prompt = page.getByRole('dialog', { name: 'Pads in the way' })
  await expect(prompt).toContainText('2 files from A1 — 2 pads already hold a sample.')
  await expect(page.getByRole('button', { name: 'Pad A1, sample replaced' })).toBeHidden()

  await prompt.getByRole('button', { name: 'Overwrite them' }).click()

  await expect(page.getByRole('button', { name: 'Pad A1, sample replaced' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pad A2, sample replaced' })).toBeVisible()
  await expect(page.getByText('Overwrote 2 pads')).toBeVisible()
})

test('skipping walks the drop past the pads in use', async ({ page }) => {
  await dropTwoOnPadA1(page)

  await page
    .getByRole('dialog', { name: 'Pads in the way' })
    .getByRole('button', { name: 'Skip them' })
    .click()

  await expect(page.getByRole('button', { name: 'Pad A4, sample added' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pad A5, sample added' })).toBeVisible()
  await expect(page.getByText('Filled 2 pads')).toBeVisible()
})

test('cancelling the prompt leaves every pad as it was', async ({ page }) => {
  await dropTwoOnPadA1(page)

  await page
    .getByRole('dialog', { name: 'Pads in the way' })
    .getByRole('button', { name: 'Cancel' })
    .click()

  await expect(page.getByRole('dialog', { name: 'Pads in the way' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Pad A1, sample replaced' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Pad A4, sample added' })).toBeHidden()
})

import { test, expect } from '@playwright/test'
import {
  backendCalls,
  cardWithFilledSlots,
  chooseFromMenu,
  stubBackend,
  STUB_PROJECT_PATH,
  type StubEntry,
} from './stubBackend'

function entry(path: string, isDir: boolean, ext: string | null = null): StubEntry {
  return { name: path.split('/').pop() ?? path, path, isDir, size: 1, ext }
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

  await expect(page.getByRole('button', { name: 'drums' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'kick.wav' })).toBeVisible()

  const commands = (await backendCalls(page)).map((call) => call.command)
  expect(commands).toContain('pick_folder')
  expect(commands).toContain('config_add_folder')

  await page.getByRole('button', { name: 'drums' }).click()
  await expect(page.getByRole('button', { name: 'snare.wav' })).toBeVisible()
})

test('removes a folder again', async ({ page }) => {
  await page.getByRole('button', { name: 'Add audio folder' }).click()
  await expect(page.getByRole('button', { name: 'kick.wav' })).toBeVisible()

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

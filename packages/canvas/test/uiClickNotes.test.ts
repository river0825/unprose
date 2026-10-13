// A UI-mock note that only says where a click goes ("Click → Settings") belongs in the file as `goto` — the lint says so
// (rule ui-note-says-where-a-click-goes), the board does not mark it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachUiFindings, clickNoteFindings, clickNoteTarget, CLICK_NOTE_RULE } from '../src/diagrams/uiMock.js'
import { designFromObject, lintDesignContent } from '../src/diagrams/index.js'
import { renderUiMock } from '../src/templates/index.js'

const SCREENS = [
  { id: 'home', name: 'Home' },
  { id: 'settings', name: 'Settings' },
  { id: 'cadence-editor', name: 'Cadence editor' },
  { id: 'cadence', name: 'Cadence' },
  { id: 'zh', name: '設定' },
]

test('clickNoteTarget: the screen a click note names, by name or id, the longest one, and what else it says', () => {
  const t = (s: string) => clickNoteTarget(s, SCREENS)
  assert.deepEqual(t('Click → Settings'), { screen: 'settings', rest: '' })
  assert.deepEqual(t('click -> settings.'), { screen: 'settings', rest: '' })
  assert.deepEqual(t('Tap: opens the Cadence editor'), { screen: 'cadence-editor', rest: '' })
  assert.deepEqual(t('Click → Cadence editor screen, with the step preselected'), { screen: 'cadence-editor', rest: 'with the step preselected' })
  assert.deepEqual(t('Click to go to Cadence'), { screen: 'cadence', rest: '' })
  assert.deepEqual(t('Clicking on it goes to cadence-editor'), { screen: 'cadence-editor', rest: '' })
  assert.deepEqual(t('點擊 → 設定頁'), { screen: 'zh', rest: '' })
  assert.deepEqual(t('點選後前往「設定」畫面'), undefined, 'a word between the click and where it goes: not just navigation')
  assert.deepEqual(t('點擊前往「設定」畫面'), { screen: 'zh', rest: '' })
  // not navigation notes
  assert.equal(t('Click to save the draft'), undefined)
  assert.equal(t('Click Settings'), undefined, 'no arrow or lead word')
  assert.equal(t('Settings are saved on click'), undefined)
  assert.equal(t('Click → Settingsbar'), undefined, 'part of a word is no screen')
  assert.equal(t('點數不足時顯示'), undefined)
})

const MOCK = {
  screens: [
    {
      id: 'home',
      name: 'Home',
      body: [
        { type: 'button', id: 'open', text: 'Open settings', note: 'Click → Settings' },
        { type: 'button', id: 'go', text: 'Go', goto: 'settings', note: 'Click → Settings' },
        { type: 'button', id: 'wrong', text: 'Wrong', goto: 'home', note: 'Click → Settings, keeps the filter' },
        { type: 'button', id: 'flowed', text: 'Flowed', note: 'Click → Settings' },
        { type: 'button', id: 'why', text: 'Why', note: 'Primary: the one thing to do here' },
        { type: 'list', id: 'menu', items: [{ text: 'Settings', note: 'Click → Settings' }] },
      ],
    },
    { id: 'settings', name: 'Settings', body: [{ type: 'heading', text: 'Settings' }] },
  ],
  flows: [{ from: 'home/flowed', to: 'settings' }],
  annotations: [{ on: 'home/why', text: 'Tap → Settings' }],
}

test('clickNoteFindings: write goto, drop a note that repeats it, warn when it contradicts it; a list entry cannot goto, so nothing', () => {
  const f = clickNoteFindings(MOCK as never)
  const by = (el: string) => f.filter((x) => x.element === el)
  assert.ok(f.every((x) => x.message.startsWith(`${CLICK_NOTE_RULE}: `)))
  assert.match(by('home/open')[0].message, /write `goto: settings` on the element .* drop the note/)
  assert.equal(by('home/open')[0].severity, 'info')
  assert.match(by('home/go')[0].message, /repeats where it goes \(goto: settings\): drop it/)
  assert.match(by('home/flowed')[0].message, /repeats where it goes \(a flow: settings\)/)
  assert.equal(by('home/wrong')[0].severity, 'warning')
  assert.match(by('home/wrong')[0].message, /says a click goes to settings, but goto leads to home/)
  assert.match(by('home/why')[0].message, /annotation on home\/why "Tap → Settings" says where a click goes/)
  assert.equal(by('home/why').length, 1, 'the element note "Primary: …" is no click note')
  assert.equal(by('home/menu').length, 0)
})

test('the lint tells it; the board does not mark it on the element', () => {
  const lint = lintDesignContent(designFromObject('design/k.ui.yaml', MOCK))
  assert.ok(lint.some((x) => x.message.startsWith(CLICK_NOTE_RULE) && x.element === 'home/open'))
  const drawn = attachUiFindings(renderUiMock(MOCK as never, { scope: 'k', now: '2026-10-13T00:00:00.000Z' }), MOCK as never)
  const marks = drawn.flatMap((i) => ((i.data?.ui as { findings?: Array<{ message: string }> } | undefined)?.findings ?? []).map((x) => x.message))
  assert.ok(!marks.some((m) => m.startsWith(CLICK_NOTE_RULE)), marks.join('\n'))
})

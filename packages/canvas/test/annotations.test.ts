// Annotations and TODOs (src/annotations.ts, src/annotationFile.ts): the predicates the web, the server and the CLI share, and the file edit
// a draft annotation proposes — one more `annotations:` entry, every other line as it was.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'yaml'
import { annotationOf, annotationRefOf, calloutOf, isAnnotationDraft, isOpenTodo, todoAnswerText, todoOf } from '../src/annotations.js'
import { addAnnotationToFile, yamlScalar } from '../src/annotationFile.js'

const comment = (data?: Record<string, unknown>, role?: string) => ({ id: 'c', type: 'comment', ...(role ? { role } : {}), ...(data ? { data } : {}) })

test('calloutOf: a note comment with a positive whole number; anything else is not a card', () => {
  assert.equal(calloutOf(comment({ callout: 3 }, 'note')), 3)
  assert.equal(calloutOf(comment({ callout: 3 })), undefined)
  assert.equal(calloutOf(comment({ callout: 0 }, 'note')), undefined)
  assert.equal(calloutOf(comment({ callout: 1.5 }, 'note')), undefined)
  assert.equal(calloutOf({ id: 's', type: 'sticky', role: 'note', data: { callout: 1 } }), undefined)
  assert.equal(calloutOf(undefined), undefined)
})

test('annotationOf / isAnnotationDraft: data.annotation on a comment, cleaned', () => {
  assert.deepEqual(annotationOf(comment({ annotation: { on: 'checkout', draft: true, file: 'design/a.es.yaml', junk: 1 } })), { on: 'checkout', draft: true, file: 'design/a.es.yaml' })
  assert.deepEqual(annotationOf(comment({ annotation: { board: true } })), { board: true })
  assert.equal(annotationOf(comment({ annotation: 'x' })), undefined)
  assert.equal(annotationOf({ id: 's', type: 'sticky', data: { annotation: { on: 'x' } } }), undefined)
  assert.ok(isAnnotationDraft(comment({ annotation: { draft: true } })))
  assert.ok(!isAnnotationDraft(comment({ annotation: { on: 'x' } })))
})

test('annotationRefOf: the element an item draws, else its id inside its diagram', () => {
  assert.equal(annotationRefOf({ id: 'es.event.paid', data: { element: 'paid' } }, 'es'), 'paid')
  assert.equal(annotationRefOf({ id: 'journey.stage.Checkout' }, 'journey'), 'stage.Checkout')
  assert.equal(annotationRefOf({ id: 'loose-sticky' }, 'journey'), 'loose-sticky')
  assert.equal(annotationRefOf({ id: 'x.y' }), 'x.y')
})

test('yamlScalar: plain when it reads back the same, else quoted', () => {
  assert.equal(yamlScalar('Order placed'), 'Order placed')
  assert.equal(yamlScalar('yes'), '"yes"')
  assert.equal(yamlScalar('a: b'), '"a: b"')
  assert.equal(yamlScalar('退款上限 3 次'), '退款上限 3 次')
  assert.equal(yamlScalar('3 tries'), '"3 tries"')
})

const entry = { on: 'paid', text: 'Shown only after the bank confirms: a refund: never before' }
const reads = (file: string) => parse(file) as { annotations?: Array<{ on: string; text: string }> }

test('addAnnotationToFile: no annotations yet — a new list at the end, the rest untouched', () => {
  const file = '# Checkout\nevents:\n  - id: paid\n    text: Paid # the bank said yes\n'
  const out = addAnnotationToFile(file, entry)
  assert.ok(out.startsWith(file))
  assert.deepEqual(reads(out).annotations, [entry])
  const noNewline = addAnnotationToFile('events: []', entry)
  assert.deepEqual(reads(noNewline).annotations, [entry])
})

test('addAnnotationToFile: after the last entry of a block list, at its indentation; what follows stays', () => {
  const file = 'events: [paid]\nannotations:\n    - on: paid\n      text: first   # keep me\nhotspots: []\n'
  const out = addAnnotationToFile(file, entry)
  assert.equal(out, 'events: [paid]\nannotations:\n    - on: paid\n      text: first   # keep me\n    - on: paid\n      text: "Shown only after the bank confirms: a refund: never before"\nhotspots: []\n')
  assert.deepEqual(reads(out).annotations, [{ on: 'paid', text: 'first' }, entry])
  // a list written flush with its key, at the end of a file with no newline
  const flush = addAnnotationToFile('annotations:\n- on: a\n  text: b', { on: 'c', text: 'd' })
  assert.deepEqual(reads(flush).annotations, [{ on: 'a', text: 'b' }, { on: 'c', text: 'd' }])
})

test('addAnnotationToFile: an empty `annotations:` or `annotations: []` becomes a block list', () => {
  for (const empty of ['annotations:\nevents: []\n', 'annotations: []\nevents: []\n', 'annotations: [] # none yet\nevents: []\n']) {
    const out = addAnnotationToFile(empty, entry)
    assert.deepEqual(reads(out).annotations, [entry], empty)
    assert.deepEqual((parse(out) as { events: unknown[] }).events, [], empty)
  }
})

test('addAnnotationToFile: a non-empty flow list still gets the entry; a file that is not a map, or a non-list, throws', () => {
  const out = addAnnotationToFile('annotations: [{ on: a, text: b }]\n', entry)
  assert.deepEqual(reads(out).annotations, [{ on: 'a', text: 'b' }, entry])
  assert.throws(() => addAnnotationToFile('- a\n- b\n', entry), /not a YAML map/)
  assert.throws(() => addAnnotationToFile('annotations: yes\n', entry), /not a list/)
  assert.throws(() => addAnnotationToFile('a: [\n', entry), /not valid YAML/)
})

test('todoOf / isOpenTodo / todoAnswerText', () => {
  assert.deepEqual(todoOf(comment({ todo: { state: 'open', ask: 'PM', answer: '' } })), { state: 'open', ask: 'PM' })
  assert.deepEqual(todoOf(comment({ todo: { state: 'done', answer: '5 tries', doneBy: 'person', doneAt: 't' } })), { state: 'done', answer: '5 tries', doneBy: 'person', doneAt: 't' })
  assert.deepEqual(todoOf(comment({ todo: {} })), { state: 'open' })
  assert.equal(todoOf(comment()), undefined)
  assert.ok(isOpenTodo(comment({ todo: { state: 'open' } })))
  assert.ok(!isOpenTodo(comment({ todo: { state: 'done' } })))
  assert.equal(todoAnswerText('  PM: 5 tries '), 'Confirmed: PM: 5 tries')
})

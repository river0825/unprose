// The link "Copy link" gives (web/src/itemLink.ts), the same from the panel and the item menu: a diagram frame by its
// key, anything else — a comment, an annotation card — by its id, the board without either; everything URL-encoded.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemLink } from '../web/src/itemLink.js'

const origin = 'https://canvas.example.com'
const board = { id: 'b_abc' }

test('itemLink: a diagram frame by its stable key, anything else by its id, the board alone without an item', () => {
  assert.equal(itemLink(board, { id: 'diagram.checkout-es', type: 'frame', data: { diagram: { kind: 'event-storming', key: 'checkout-es' } } }, origin), 'https://canvas.example.com/b/b_abc?frame=checkout-es')
  assert.equal(itemLink(board, { id: 'f_1', type: 'frame', data: {} }, origin), 'https://canvas.example.com/b/b_abc?focus=f_1', 'a plain frame has no key')
  assert.equal(itemLink(board, { id: 'es.event.paid', type: 'sticky' }, origin), 'https://canvas.example.com/b/b_abc?focus=es.event.paid')
  assert.equal(itemLink(board, { id: 'es.annotation.2', type: 'comment', data: { callout: 2 } }, origin), 'https://canvas.example.com/b/b_abc?focus=es.annotation.2', 'an annotation card')
  assert.equal(itemLink(board, undefined, origin), 'https://canvas.example.com/b/b_abc')
})

test('itemLink: ids, keys and the board id are encoded', () => {
  assert.equal(itemLink({ id: 'b 1/x' }, { id: 'a&b c', type: 'sticky' }, 'http://localhost:4400'), 'http://localhost:4400/b/b%201%2Fx?focus=a%26b%20c')
  assert.equal(itemLink(board, { id: 'diagram.k', type: 'frame', data: { diagram: { key: 'ä k' } } }, origin), 'https://canvas.example.com/b/b_abc?frame=%C3%A4%20k')
})

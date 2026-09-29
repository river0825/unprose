import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evalExpr, template, templateDeep, evalCondition, rootIdentifiers } from '../src/expr.js'

const scope = { event: { data: { to: 'Ready', size: 'M', n: 3, tags: ['a', 'b'] } }, vars: { qualify: { size: 'XL' } }, key: 'abc' }

test('literals, access, comparison', () => {
  assert.equal(evalExpr("event.data.to == 'Ready'", scope), true)
  assert.equal(evalExpr('event.data.n > 2 && event.data.n < 4', scope), true)
  assert.equal(evalExpr("event.data.missing == null", scope), true)
  assert.equal(evalExpr("event.data.tags[1]", scope), 'b')
  assert.equal(evalExpr("event['data']['size']", scope), 'M')
  assert.equal(evalExpr('1 + 2 * 3', scope), 7)
  assert.equal(evalExpr('(1 + 2) * 3', scope), 9)
  assert.equal(evalExpr("'a' + 'b'", scope), 'ab')
})

test('in, functions, ternary', () => {
  assert.equal(evalExpr("event.data.size in ['XS','S','M','L']", scope), true)
  assert.equal(evalExpr("vars.qualify.size in ['XS','S','M','L']", scope), false)
  assert.equal(evalExpr("'ea' in 'Ready'", scope), true)
  assert.equal(evalExpr('len(event.data.tags)', scope), 2)
  assert.equal(evalExpr("lower(event.data.to)", scope), 'ready')
  assert.equal(evalExpr("startsWith(event.data.to, 'Re')", scope), true)
  assert.equal(evalExpr("default(event.data.nope, 'x')", scope), 'x')
  assert.equal(evalExpr("event.data.n > 2 ? 'big' : 'small'", scope), 'big')
  assert.equal(evalExpr('!event.data.missing', scope), true)
})

test('safety: no prototype access, unknown ids are undefined', () => {
  assert.equal(evalExpr('event.constructor', scope), undefined)
  assert.equal(evalExpr('event.__proto__', scope), undefined)
  assert.equal(evalExpr('nothing.here', scope), undefined)
  assert.throws(() => evalExpr('process.exit()', scope))
})

test('templates keep type for a single expression', () => {
  assert.equal(template('{{ event.data.n }}', scope), 3)
  assert.deepEqual(template('{{ event.data.tags }}', scope), ['a', 'b'])
  assert.equal(template('card {{ key }} → {{ event.data.to }}', scope), 'card abc → Ready')
  assert.deepEqual(templateDeep({ a: '{{ key }}', b: ['{{ event.data.n }}'], c: 'x' }, scope), { a: 'abc', b: [3], c: 'x' })
})

test('conditions and identifiers', () => {
  assert.equal(evalCondition(undefined, scope), true)
  assert.equal(evalCondition("event.data.to == 'Backlog'", scope), false)
  assert.deepEqual(rootIdentifiers("event.data.to == 'x' && len(vars.q) > 0").sort(), ['event', 'vars'])
})

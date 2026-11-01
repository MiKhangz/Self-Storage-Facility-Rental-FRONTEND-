import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fill } from '../src/i18n/fill.js'

test('fill puts values in holes and leaves unknown holes alone', () => {
  assert.equal(fill('Kho {code}', { code: 'A-101' }), 'Kho A-101')
  assert.equal(fill('{a} {b}', { a: 1 }), '1 {b}')
  assert.equal(fill('{a}'), '{a}')
})

test('{name:s} adds the plural ending except for exactly one', () => {
  const units = '{n} unit{n:s}'
  assert.equal(fill(units, { n: 1 }), '1 unit')
  assert.equal(fill(units, { n: 0 }), '0 units')
  assert.equal(fill(units, { n: 2 }), '2 units')
})

import assert from 'node:assert/strict'
import { suggestEntries } from '../src/extract.ts'
const now = new Date(2026, 10, 16, 12)
const phrases = [
  'Spent one hundred and fifty rupees on lunch today.',
  'Rahul owes me eight hundred rupees.',
  'I owe Priya twelve hundred rupees.',
  'Rahul returned three hundred rupees yesterday.',
  'Spent fifty rupees, not fifteen rupees.',
  'Paid two hundred for lunch and six hundred for groceries.',
]
const results = phrases.map(text => suggestEntries(text, now))
assert.equal(results[0][0].amount, '150')
assert.equal(results[0][0].description, 'lunch')
assert.equal(results[1][0].kind, 'lent')
assert.equal(results[1][0].person, 'Rahul')
assert.equal(results[1][0].amount, '800')
assert.equal(results[2][0].kind, 'borrowed')
assert.equal(results[2][0].person, 'Priya')
assert.equal(results[2][0].amount, '1200')
assert.equal(results[3][0].kind, 'repayment-received')
assert.equal(results[3][0].date, '2026-11-15')
assert.equal(results[4][0].amount, '50')
assert.deepEqual(results[5].map(entry => [entry.amount, entry.description]), [['200', 'lunch'], ['600', 'groceries']])
assert.equal(suggestEntries('I repaid Priya three hundred rupees', now)[0].kind, 'repayment-paid')
assert.equal(suggestEntries('Bought lunch', now)[0].amount, '')
console.log('PASS: six supplied phrases, names, amounts, two expenses, yesterday, repayment paid, missing amount')

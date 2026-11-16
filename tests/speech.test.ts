import assert from 'node:assert/strict'
import { collectResults } from '../src/speech.ts'
const result = (text: string, isFinal = true) => ({ isFinal, 0: { transcript: text } })
const committed = new Set<number>()
assert.deepEqual(collectResults([result('Spent fifty'), result('rupees', false)], committed), { final: 'Spent fifty', interim: 'rupees' })
assert.deepEqual(collectResults([result('Spent fifty'), result('rupees')], committed), { final: 'rupees', interim: '' })
assert.equal(collectResults([result('Spent fifty'), result('rupees')], committed).final, '')
assert.equal(collectResults([result('Spent fifty'), result('rupees'), result('rupees')], committed).final, 'rupees')
assert.equal(collectResults([result('Spent fifty')], new Set()).final, 'Spent fifty')
assert.equal(collectResults([], new Set()).interim, '')
console.log('PASS: interim/final transitions, replay deduplication, repeated words, fresh sessions, empty results')

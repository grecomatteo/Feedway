import { describe, expect, it } from 'vitest'
import { validateDefaultPostTime, validateLabel } from './validate.js'

describe('validateDefaultPostTime', () => {
  it('takes HH:MM and null', () => {
    expect(validateDefaultPostTime('00:00')).toEqual({ ok: true, value: '00:00' })
    expect(validateDefaultPostTime('18:30')).toEqual({ ok: true, value: '18:30' })
    expect(validateDefaultPostTime('23:59')).toEqual({ ok: true, value: '23:59' })
    expect(validateDefaultPostTime(null)).toEqual({ ok: true, value: null })
  })
  it.each(['24:00', '7:30', '18:60', '18:30:00', '', ' 18:30', '18h30'])('refuses %j', (v) => {
    expect(validateDefaultPostTime(v)).toEqual({ ok: false })
  })
})

describe('validateLabel', () => {
  it('trims the name and keeps a theme colour', () => {
    expect(validateLabel({ name: '  Promo  ', color: 'verde' })).toEqual({
      ok: true,
      value: { name: 'Promo', color: 'verde' },
    })
  })
  it('takes 1 to 40 characters', () => {
    expect(validateLabel({ name: 'a', color: 'blu' }).ok).toBe(true)
    expect(validateLabel({ name: 'é'.repeat(40), color: 'blu' }).ok).toBe(true)
    expect(validateLabel({ name: 'a'.repeat(41), color: 'blu' })).toEqual({
      ok: false,
      field: 'name',
    })
    expect(validateLabel({ name: '   ', color: 'blu' })).toEqual({ ok: false, field: 'name' })
  })
  it('refuses a link in the name', () => {
    expect(validateLabel({ name: 'https://x.it', color: 'blu' })).toEqual({
      ok: false,
      field: 'name',
    })
  })
  it('refuses a colour outside the themes', () => {
    expect(validateLabel({ name: 'Promo', color: '#ff0000' })).toEqual({
      ok: false,
      field: 'color',
    })
  })
})

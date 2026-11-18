import { describe, expect, it } from 'vitest'
import {
  CAPTION_TEMPLATE_BODY_MAX_LENGTH,
  validateCaptionTemplate,
  validateDefaultPostTime,
  validateGroupName,
  validateLabel,
  validateNoteBody,
} from './validate.js'

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

describe('validateCaptionTemplate', () => {
  it('trims the name, keeps the text as written', () => {
    expect(
      validateCaptionTemplate({ kind: 'signature', name: ' Firma ', body: 'Forno Luce\n' }),
    ).toEqual({ ok: true, value: { kind: 'signature', name: 'Firma', body: 'Forno Luce\n' } })
  })
  it('refuses an unknown kind, an empty or long name, an empty or long text', () => {
    const ok = { kind: 'hashtags', name: 'Pane', body: '#pane' }
    expect(validateCaptionTemplate({ ...ok, kind: 'emoji' })).toEqual({ ok: false, field: 'kind' })
    expect(validateCaptionTemplate({ ...ok, name: ' ' })).toEqual({ ok: false, field: 'name' })
    expect(validateCaptionTemplate({ ...ok, name: 'a'.repeat(81) })).toEqual({
      ok: false,
      field: 'name',
    })
    expect(validateCaptionTemplate({ ...ok, body: ' \n ' })).toEqual({ ok: false, field: 'body' })
    expect(
      validateCaptionTemplate({ ...ok, body: 'a'.repeat(CAPTION_TEMPLATE_BODY_MAX_LENGTH + 1) }),
    ).toEqual({ ok: false, field: 'body' })
    expect(
      validateCaptionTemplate({ ...ok, body: 'é'.repeat(CAPTION_TEMPLATE_BODY_MAX_LENGTH) }).ok,
    ).toBe(true)
  })
})

describe('validateGroupName and validateNoteBody', () => {
  it('a group name is plain, 1 to 80 characters', () => {
    expect(validateGroupName('  Solo Instagram ')).toBe('Solo Instagram')
    expect(validateGroupName('')).toBeNull()
    expect(validateGroupName('a'.repeat(81))).toBeNull()
    expect(validateGroupName('www.forno.it')).toBeNull()
  })
  it('a note is trimmed, 1 to 2000 characters', () => {
    expect(validateNoteBody('  Prezzo da confermare \n')).toBe('Prezzo da confermare')
    expect(validateNoteBody('  ')).toBeNull()
    expect(validateNoteBody('a'.repeat(2001))).toBeNull()
    expect(validateNoteBody('a'.repeat(2000))).toBe('a'.repeat(2000))
  })
})

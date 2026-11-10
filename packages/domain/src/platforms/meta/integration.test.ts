import { expect, test } from 'vitest'
import { checkMetaIntegrationConfig } from './integration.js'

const valid = {
  appId: '1000000000000001',
  configId: '2000000000000001',
  businessId: '3000000000000001',
  dataUseCheckupDueOn: '2027-03-31',
}

test('a complete config passes as it is', () => {
  expect(checkMetaIntegrationConfig(valid)).toEqual({ ok: true, value: valid })
})

test('only the App ID is required: the others may be null or left out', () => {
  expect(checkMetaIntegrationConfig({ appId: ' 1000000000000001 ' })).toEqual({
    ok: true,
    value: {
      appId: '1000000000000001',
      configId: null,
      businessId: null,
      dataUseCheckupDueOn: null,
    },
  })
  expect(checkMetaIntegrationConfig({ ...valid, configId: '', businessId: null })).toMatchObject({
    ok: true,
    value: { configId: null, businessId: null },
  })
})

test.each([
  ['appId', { ...valid, appId: '' }],
  ['appId', { ...valid, appId: 'abc' }],
  ['appId', { ...valid, appId: '1'.repeat(33) }],
  ['configId', { ...valid, configId: '12a' }],
  ['businessId', { ...valid, businessId: 'act_123' }],
  ['dataUseCheckupDueOn', { ...valid, dataUseCheckupDueOn: '31/03/2027' }],
  ['dataUseCheckupDueOn', { ...valid, dataUseCheckupDueOn: '2027-02-30' }],
] as const)('%s refused: %j', (field, input) => {
  expect(checkMetaIntegrationConfig(input)).toEqual({ ok: false, field })
})

test('anything that is not the config is refused, extra keys included', () => {
  expect(checkMetaIntegrationConfig(null)).toEqual({ ok: false, field: 'appId' })
  expect(checkMetaIntegrationConfig({ ...valid, appSecret: 'x' })).toEqual({
    ok: false,
    field: 'appSecret',
  })
})

import { assert } from 'chai'
import { describe, it } from 'mocha'
import { getConfiguredEnvironment } from '../envfile'

describe('EnvFile', () => {
    it('should work without envfile', () => {
        const ret = getConfiguredEnvironment({ env: { TEST: 'TEST' } })
        assert.deepEqual(ret, { TEST: 'TEST' })
    })
    it('should work with missing envfile', () => {
        const ret = getConfiguredEnvironment({ env: { TEST: 'TEST' }, envFile: 'NONEXISTINGFILE' })
        assert.deepEqual(ret, { TEST: 'TEST' })
    })
    it('should merge envfile', () => {
        const ret = getConfiguredEnvironment({ env: { TEST: 'TEST' }, envFile: 'testproject/envfile' })
        assert.deepEqual(ret, { TEST: 'TEST', TEST1: 'VALUE1', Test2: 'Value2' })
    })
    ;(process.platform === 'win32' ? it : it.skip)('should merge envfile on win32', () => {
        const ret = getConfiguredEnvironment({ env: { TEST1: 'TEST' }, envFile: 'testproject/envfile' })
        assert.deepEqual(ret, { TEST1: 'TEST', Test2: 'Value2' })
    })
    ;(process.platform === 'win32' ? it : it.skip)('should merge envfile on win32 case insensitive', () => {
        const ret = getConfiguredEnvironment({ env: { Test1: 'TEST' }, envFile: 'testproject/envfile' })
        assert.deepEqual(ret, { TEST1: 'TEST', Test2: 'Value2' })
    })
    ;(process.platform !== 'win32' ? it : it.skip)('should merge envfile on unix', () => {
        const ret = getConfiguredEnvironment({ env: { TEST1: 'TEST' }, envFile: 'testproject/envfile' })
        assert.deepEqual(ret, { TEST1: 'TEST', Test2: 'Value2' })
    })
    ;(process.platform !== 'win32' ? it : it.skip)('should merge envfile on unix case insensitive', () => {
        const ret = getConfiguredEnvironment({ env: { Test1: 'TEST' }, envFile: 'testproject/envfile' })
        assert.deepEqual(ret, { Test1: 'TEST', TEST1: 'VALUE1', Test2: 'Value2' })
    })
})

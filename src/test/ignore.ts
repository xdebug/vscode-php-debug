import { assert } from 'chai'
import { describe, it } from 'mocha'
import { shouldIgnoreException } from '../ignore'

describe('ignoreExceptions', () => {
    it('should match exact', () => {
        assert.isTrue(shouldIgnoreException('BaseException', ['BaseException']))
    })
    it('should no match exact', () => {
        assert.isFalse(shouldIgnoreException('BaseException', ['SomeOtherException']))
    })
    it('should match wildcard end exact', () => {
        assert.isTrue(shouldIgnoreException('BaseException', ['BaseException*']))
    })
    it('should match wildcard end extra', () => {
        assert.isTrue(shouldIgnoreException('BaseExceptionMore', ['BaseException*']))
    })
    it('should match namespaced exact', () => {
        assert.isTrue(shouldIgnoreException('NS1\\BaseException', ['NS1\\BaseException']))
    })
    it('should match namespaced wildcard exact', () => {
        assert.isTrue(shouldIgnoreException('NS1\\BaseException', ['NS1\\BaseException*']))
    })
    it('should match namespaced wildcard extra', () => {
        assert.isTrue(shouldIgnoreException('NS1\\BaseExceptionMore', ['NS1\\BaseException*']))
    })
    it('should match namespaced wildcard whole level', () => {
        assert.isTrue(shouldIgnoreException('NS1\\BaseException', ['NS1\\*']))
    })
    it('should not match namespaced wildcard more levels', () => {
        assert.isFalse(shouldIgnoreException('NS1\\NS2\\BaseException', ['NS1\\*']))
    })
    it('should match namespaced wildcard in middle', () => {
        assert.isTrue(shouldIgnoreException('NS1\\NS2\\BaseException', ['NS1\\*\\BaseException']))
    })
    it('should match namespaced wildcard multiple', () => {
        assert.isTrue(shouldIgnoreException('NS1\\NS2\\NS3\\BaseException', ['NS1\\*\\*\\BaseException']))
    })
    it('should match namespaced wildcard levels', () => {
        assert.isTrue(shouldIgnoreException('NS1\\NS2\\NS3\\BaseException', ['NS1\\**\\BaseException']))
    })
})

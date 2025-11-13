import { assert } from 'chai'
import { describe, it, beforeEach, afterEach } from 'mocha'

// Inline the function for testing without vscode dependency
function resolveEnvVariables(value: string): string {
    return value.replace(/\$\{env:([^}]+)\}/g, (match, envVar: string) => {
        const envValue = process.env[envVar]
        return envValue !== undefined ? envValue : match
    })
}

describe('Environment Variable Resolution', () => {
    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
        originalEnv = { ...process.env }
    })

    afterEach(() => {
        process.env = originalEnv
    })

    it('should resolve ${env:VAR_NAME} with existing environment variable', () => {
        process.env.TEST_VAR = '/test/path'
        const result = resolveEnvVariables('${env:TEST_VAR}/subdir')
        assert.equal(result, '/test/path/subdir')
    })

    it('should keep ${env:VAR_NAME} if environment variable does not exist', () => {
        delete process.env.NONEXISTENT_VAR
        const result = resolveEnvVariables('${env:NONEXISTENT_VAR}/subdir')
        assert.equal(result, '${env:NONEXISTENT_VAR}/subdir')
    })

    it('should resolve multiple environment variables', () => {
        process.env.VAR1 = '/path1'
        process.env.VAR2 = '/path2'
        const result = resolveEnvVariables('${env:VAR1}/${env:VAR2}')
        assert.equal(result, '/path1//path2')
    })

    it('should handle text without environment variables', () => {
        const result = resolveEnvVariables('/var/www/html')
        assert.equal(result, '/var/www/html')
    })

    it('should handle environment variables with underscores and numbers', () => {
        process.env.MY_VAR_123 = '/custom/path'
        const result = resolveEnvVariables('${env:MY_VAR_123}')
        assert.equal(result, '/custom/path')
    })

    it('should handle empty environment variable value', () => {
        process.env.EMPTY_VAR = ''
        const result = resolveEnvVariables('${env:EMPTY_VAR}/test')
        assert.equal(result, '/test')
    })

    it('should handle mixed content', () => {
        process.env.DOCKER_ROOT = '/var/www/html'
        const result = resolveEnvVariables('prefix/${env:DOCKER_ROOT}/suffix')
        assert.equal(result, 'prefix//var/www/html/suffix')
    })

    it('should handle pathMapping use case', () => {
        process.env.DOCKER_WEB_ROOT = '/var/www/html'
        process.env.LOCAL_PROJECT = '/Users/developer/myproject'

        const serverPath = '${env:DOCKER_WEB_ROOT}'
        const localPath = '${env:LOCAL_PROJECT}'

        assert.equal(resolveEnvVariables(serverPath), '/var/www/html')
        assert.equal(resolveEnvVariables(localPath), '/Users/developer/myproject')
    })
})

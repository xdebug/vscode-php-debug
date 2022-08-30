import { LogPointManager } from '../logpoint'
import * as assert from 'assert'
import { describe, it, beforeEach } from 'mocha'

describe('logpoint', () => {
    const FILE_URI1 = 'file://my/file1'
    const FILE_URI2 = 'file://my/file2'
    const FILE_URI3 = 'file://my/file3'

    const LOG_MESSAGE_VAR = '{$variable1}'
    const LOG_MESSAGE_MULTIPLE = '{$variable1} {$variable3} {$variable2}'
    const LOG_MESSAGE_TEXT_AND_VAR = 'This is my {$variable1}'
    const LOG_MESSAGE_TEXT_AND_MULTIVAR = 'Those variables: {$variable1} ${$variable2} should be replaced'
    const LOG_MESSAGE_REPEATED_VAR = 'This {$variable1} and {$variable1} should be equal'
    const LOG_MESSAGE_BADLY_FORMATED_VAR = 'Only {$variable1} should be resolved and not }$variable1 and $variable1{}'

    const REPLACE_FUNCTION = (str: string): Promise<string> => {
        return Promise.resolve(`${str}_value`)
    }

    let logPointManager: LogPointManager

    beforeEach('create new instance', () => (logPointManager = new LogPointManager()))

    describe('basic map management', () => {
        it('should contain added logpoints', () => {
            logPointManager.addLogPoint(FILE_URI1, 10, LOG_MESSAGE_VAR)
            logPointManager.addLogPoint(FILE_URI1, 11, LOG_MESSAGE_VAR)
            logPointManager.addLogPoint(FILE_URI2, 12, LOG_MESSAGE_VAR)
            logPointManager.addLogPoint(FILE_URI3, 13, LOG_MESSAGE_VAR)

            assert.equal(logPointManager.hasLogPoint(FILE_URI1, 10), true)
            assert.equal(logPointManager.hasLogPoint(FILE_URI1, 11), true)
            assert.equal(logPointManager.hasLogPoint(FILE_URI2, 12), true)
            assert.equal(logPointManager.hasLogPoint(FILE_URI3, 13), true)

            assert.equal(logPointManager.hasLogPoint(FILE_URI1, 12), false)
            assert.equal(logPointManager.hasLogPoint(FILE_URI2, 13), false)
            assert.equal(logPointManager.hasLogPoint(FILE_URI3, 10), false)
        })

        it('should add and clear entries', () => {
            logPointManager.addLogPoint(FILE_URI1, 10, LOG_MESSAGE_VAR)
            logPointManager.addLogPoint(FILE_URI1, 11, LOG_MESSAGE_VAR)
            logPointManager.addLogPoint(FILE_URI2, 12, LOG_MESSAGE_VAR)
            logPointManager.addLogPoint(FILE_URI3, 13, LOG_MESSAGE_VAR)

            assert.equal(logPointManager.hasLogPoint(FILE_URI1, 10), true)
            assert.equal(logPointManager.hasLogPoint(FILE_URI1, 11), true)
            assert.equal(logPointManager.hasLogPoint(FILE_URI2, 12), true)
            assert.equal(logPointManager.hasLogPoint(FILE_URI3, 13), true)

            logPointManager.clearFromFile(FILE_URI1)

            assert.equal(logPointManager.hasLogPoint(FILE_URI1, 10), false)
            assert.equal(logPointManager.hasLogPoint(FILE_URI1, 11), false)
            assert.equal(logPointManager.hasLogPoint(FILE_URI2, 12), true)
            assert.equal(logPointManager.hasLogPoint(FILE_URI3, 13), true)
        })
    })

    describe('variable resolution', () => {
        it('should resolve variables', async () => {
            logPointManager.addLogPoint(FILE_URI1, 10, LOG_MESSAGE_VAR)
            const result = await logPointManager.resolveExpressions(FILE_URI1, 10, REPLACE_FUNCTION)
            assert.equal(result, '$variable1_value')
        })

        it('should resolve multiple variables', async () => {
            logPointManager.addLogPoint(FILE_URI1, 10, LOG_MESSAGE_MULTIPLE)
            const result = await logPointManager.resolveExpressions(FILE_URI1, 10, REPLACE_FUNCTION)
            assert.equal(result, '$variable1_value $variable3_value $variable2_value')
        })

        it('should resolve variables with text', async () => {
            logPointManager.addLogPoint(FILE_URI1, 10, LOG_MESSAGE_TEXT_AND_VAR)
            const result = await logPointManager.resolveExpressions(FILE_URI1, 10, REPLACE_FUNCTION)
            assert.equal(result, 'This is my $variable1_value')
        })

        it('should resolve multiple variables with text', async () => {
            logPointManager.addLogPoint(FILE_URI1, 10, LOG_MESSAGE_TEXT_AND_MULTIVAR)
            const result = await logPointManager.resolveExpressions(FILE_URI1, 10, REPLACE_FUNCTION)
            assert.equal(result, 'Those variables: $variable1_value $$variable2_value should be replaced')
        })

        it('should resolve repeated variables', async () => {
            logPointManager.addLogPoint(FILE_URI1, 10, LOG_MESSAGE_REPEATED_VAR)
            const result = await logPointManager.resolveExpressions(FILE_URI1, 10, REPLACE_FUNCTION)
            assert.equal(result, 'This $variable1_value and $variable1_value should be equal')
        })

        it('should resolve repeated bad formated messages correctly', async () => {
            logPointManager.addLogPoint(FILE_URI1, 10, LOG_MESSAGE_BADLY_FORMATED_VAR)
            const result = await logPointManager.resolveExpressions(FILE_URI1, 10, REPLACE_FUNCTION)
            assert.equal(result, 'Only $variable1_value should be resolved and not }$variable1 and $variable1')
        })
    })
})

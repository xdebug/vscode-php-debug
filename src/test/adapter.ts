import * as chai from 'chai'
import chaiAsPromised = require('chai-as-promised')
import * as path from 'path'
import { DebugClient } from 'vscode-debugadapter-testsupport'
import { DebugProtocol } from 'vscode-debugprotocol'
import * as semver from 'semver'
chai.use(chaiAsPromised)
const assert = chai.assert

describe('PHP Debug Adapter', () => {
    const TEST_PROJECT = path.normalize(__dirname + '/../../testproject')

    let client: DebugClient

    beforeEach('start debug adapter', async () => {
        client = new DebugClient('node', path.normalize(__dirname + '/../phpDebug'), 'php')
        client.defaultTimeout = 10000
        await client.start(process.env['VSCODE_DEBUG_PORT'] ? parseInt(process.env['VSCODE_DEBUG_PORT']) : undefined)
    })

    afterEach('stop debug adapter', () => client.stop())

    describe('initialization', () => {
        it('should return supported features', async () => {
            const response = await client.initializeRequest()
            assert.equal(response.body!.supportsConfigurationDoneRequest, true)
            assert.equal(response.body!.supportsEvaluateForHovers, false)
            assert.equal(response.body!.supportsConditionalBreakpoints, true)
            assert.equal(response.body!.supportsFunctionBreakpoints, true)
        })
    })

    describe('launch as CLI', () => {
        const program = path.join(TEST_PROJECT, 'hello_world.php')

        it('should error on non-existing file', () =>
            assert.isRejected(client.launch({ program: 'thisfiledoesnotexist.php' })))

        it('should run program to the end', () =>
            Promise.all([
                client.launch({ program }),
                client.configurationSequence(),
                client.waitForEvent('terminated'),
            ]))

        it('should stop on entry', async () => {
            const [event] = await Promise.all([
                client.waitForEvent('stopped'),
                client.launch({ program, stopOnEntry: true }),
                client.configurationSequence(),
            ])
            assert.propertyVal(event.body, 'reason', 'entry')
        })

        it('should not stop if launched without debugging', () =>
            Promise.all([
                client.launch({ program, stopOnEntry: true, noDebug: true }),
                client.waitForEvent('terminated'),
            ]))
    })

    describe('continuation commands', () => {
        const program = path.join(TEST_PROJECT, 'function.php')

        it('should handle run')
        it('should handle step_over')
        it('should handle step_in')
        it('should handle step_out')

        it('should error on pause request', () => assert.isRejected(client.pauseRequest({ threadId: 1 })))

        it('should handle disconnect', async () => {
            await Promise.all([client.launch({ program, stopOnEntry: true }), client.waitForEvent('initialized')])
            await client.disconnectRequest()
        })
    })

    async function assertStoppedLocation(
        reason: 'entry' | 'breakpoint' | 'exception',
        path: string,
        line: number
    ): Promise<{ threadId: number; frame: DebugProtocol.StackFrame }> {
        const event = (await client.waitForEvent('stopped')) as DebugProtocol.StoppedEvent
        assert.propertyVal(event.body, 'reason', reason)
        const threadId = event.body.threadId!
        const response = await client.stackTraceRequest({ threadId })
        const frame = response.body.stackFrames[0]
        let expectedPath = path
        let actualPath = frame.source!.path!
        if (process.platform === 'win32') {
            expectedPath = expectedPath.toLowerCase()
            actualPath = actualPath.toLowerCase()
        }
        assert.equal(actualPath, expectedPath, 'stopped location: path mismatch')
        assert.equal(frame.line, line, 'stopped location: line mismatch')
        return { threadId, frame }
    }

    describe('breakpoints', () => {
        const program = path.join(TEST_PROJECT, 'hello_world.php')

        async function waitForBreakpointUpdate(breakpoint: DebugProtocol.Breakpoint): Promise<void> {
            while (true) {
                let event = (await client.waitForEvent('breakpoint')) as DebugProtocol.BreakpointEvent
                if (event.body.breakpoint.id === breakpoint.id) {
                    for (const [key, value] of Object.entries(event.body.breakpoint)) {
                        ;(breakpoint as any)[key] = value
                    }
                    break
                }
            }
        }

        describe('line breakpoints', () => {
            async function testBreakpointHit(program: string, line: number): Promise<void> {
                await Promise.all([client.launch({ program }), client.waitForEvent('initialized')])
                const breakpoint = (
                    await client.setBreakpointsRequest({
                        breakpoints: [{ line }],
                        source: { path: program },
                    })
                ).body.breakpoints[0]
                await waitForBreakpointUpdate(breakpoint)
                assert.isTrue(breakpoint.verified, 'breakpoint verification mismatch: verified')
                assert.equal(breakpoint.line, line, 'breakpoint verification mismatch: line')
                await Promise.all([
                    client.configurationDoneRequest(),
                    assertStoppedLocation('breakpoint', program, line),
                ])
            }

            it('should stop on a breakpoint', () => testBreakpointHit(program, 4))

            it('should stop on a breakpoint in file with spaces in its name', () =>
                testBreakpointHit(path.join(TEST_PROJECT, 'folder with spaces', 'file with spaces.php'), 4))

            it('should stop on a breakpoint identical to the entrypoint', () => testBreakpointHit(program, 3))

            it('should support removing a breakpoint', async () => {
                await Promise.all([client.launch({ program }), client.waitForEvent('initialized')])
                // set two breakpoints
                let breakpoints = (
                    await client.setBreakpointsRequest({
                        breakpoints: [{ line: 3 }, { line: 5 }],
                        source: { path: program },
                    })
                ).body.breakpoints
                await waitForBreakpointUpdate(breakpoints[0])
                await waitForBreakpointUpdate(breakpoints[1])
                assert.lengthOf(breakpoints, 2)
                assert.isTrue(breakpoints[0].verified, 'breakpoint verification mismatch: verified')
                assert.equal(breakpoints[0].line, 3, 'breakpoint verification mismatch: line')
                assert.isTrue(breakpoints[1].verified, 'breakpoint verification mismatch: verified')
                assert.equal(breakpoints[1].line, 5, 'breakpoint verification mismatch: line')
                // stop at first
                const [{ threadId }] = await Promise.all([
                    assertStoppedLocation('breakpoint', program, 3),
                    client.configurationDoneRequest(),
                ])
                // remove second
                breakpoints = (
                    await client.setBreakpointsRequest({
                        breakpoints: [{ line: 3 }],
                        source: { path: program },
                    })
                ).body.breakpoints
                await waitForBreakpointUpdate(breakpoints[0])
                assert.lengthOf(breakpoints, 1)
                assert.isTrue(breakpoints[0].verified, 'breakpoint verification mismatch: verified')
                assert.equal(breakpoints[0].line, 3, 'breakpoint verification mismatch: line')
                // should run to end
                await Promise.all([client.waitForEvent('terminated'), client.continueRequest({ threadId })])
            })
        })

        describe('exception breakpoints', () => {
            const program = path.join(TEST_PROJECT, 'error.php')

            it('should not break on anything if the file matches the ignore pattern', async () => {
                await Promise.all([client.launch({ program, ignore: ['**/*.*'] }), client.waitForEvent('initialized')])
                await client.setExceptionBreakpointsRequest({ filters: ['*'] })
                await Promise.all([client.configurationDoneRequest(), client.waitForEvent('terminated')])
            })

            it('should support stopping only on a notice', async () => {
                await Promise.all([client.launch({ program }), client.waitForEvent('initialized')])
                await client.setExceptionBreakpointsRequest({ filters: ['Notice'] })
                const [, { threadId }] = await Promise.all([
                    client.configurationDoneRequest(),
                    assertStoppedLocation('exception', program, 6),
                ])
                await Promise.all([client.continueRequest({ threadId }), client.waitForEvent('terminated')])
            })

            it('should support stopping only on a warning', async () => {
                await Promise.all([client.launch({ program }), client.waitForEvent('initialized')])
                await client.setExceptionBreakpointsRequest({ filters: ['Warning'] })
                const [{ threadId }] = await Promise.all([
                    assertStoppedLocation('exception', program, 9),
                    client.configurationDoneRequest(),
                ])
                await Promise.all([client.continueRequest({ threadId }), client.waitForEvent('terminated')])
            })

            it('should support stopping only on an error')

            it('should support stopping only on an exception', async () => {
                await Promise.all([client.launch({ program }), client.waitForEvent('initialized')])
                await client.setExceptionBreakpointsRequest({ filters: ['Exception'] })
                const [, { threadId }] = await Promise.all([
                    client.configurationDoneRequest(),
                    assertStoppedLocation('exception', program, 12),
                ])
                await Promise.all([client.continueRequest({ threadId }), client.waitForEvent('terminated')])
            })

            // support for stopping on "*" was added in 2.3.0
            if (!process.env['XDEBUG_VERSION'] || semver.gte(process.env['XDEBUG_VERSION'], '2.3.0')) {
                it('should support stopping on everything', async () => {
                    await Promise.all([client.launch({ program }), client.waitForEvent('initialized')])
                    await client.setExceptionBreakpointsRequest({ filters: ['*'] })
                    // Notice
                    const [, { threadId }] = await Promise.all([
                        client.configurationDoneRequest(),
                        assertStoppedLocation('exception', program, 6),
                    ])
                    // Warning
                    await Promise.all([
                        client.continueRequest({ threadId }),
                        assertStoppedLocation('exception', program, 9),
                    ])
                    // Exception
                    await Promise.all([
                        client.continueRequest({ threadId }),
                        assertStoppedLocation('exception', program, 12),
                    ])
                    // Fatal error: uncaught exception
                    await Promise.all([
                        client.continueRequest({ threadId }),
                        assertStoppedLocation('exception', program, 12),
                    ])
                    await Promise.all([client.continueRequest({ threadId }), client.waitForEvent('terminated')])
                })
            }

            it.skip('should report the error in a virtual error scope', async () => {
                await Promise.all([client.launch({ program }), client.waitForEvent('initialized')])
                await client.setExceptionBreakpointsRequest({ filters: ['Notice', 'Warning', 'Exception'] })
                const [
                    {
                        body: { threadId },
                    },
                ] = await Promise.all([
                    client.waitForEvent('stopped') as Promise<DebugProtocol.StoppedEvent>,
                    client.configurationDoneRequest(),
                ])

                interface ErrorScope {
                    name: string
                    type?: string
                    message?: string
                    code?: string
                }

                async function getErrorScope(): Promise<ErrorScope> {
                    const frameId = (await client.stackTraceRequest({ threadId: threadId! })).body.stackFrames[0].id
                    const errorScope = (await client.scopesRequest({ frameId })).body.scopes[0]
                    const variables = (
                        await client.variablesRequest({
                            variablesReference: errorScope.variablesReference,
                        })
                    ).body.variables
                    const errorInfo: ErrorScope = { name: errorScope.name }
                    const type = variables.find(variable => variable.name === 'type')
                    if (type) {
                        errorInfo.type = type.value
                    }
                    const message = variables.find(variable => variable.name === 'message')
                    if (message) {
                        errorInfo.message = message.value
                    }
                    const code = variables.find(variable => variable.name === 'code')
                    if (code) {
                        errorInfo.code = code.value
                    }
                    return errorInfo
                }
                let expectedErrorScope: ErrorScope = {
                    name: 'Notice',
                    type: 'Notice',
                    message: '"Undefined index: undefined_index"',
                }
                if (!process.env['XDEBUG_VERSION'] || semver.gte(process.env['XDEBUG_VERSION'], '2.3.0')) {
                    expectedErrorScope.code = '8'
                }
                assert.deepEqual(await getErrorScope(), expectedErrorScope)
                await Promise.all([client.continueRequest({ threadId: threadId! }), client.waitForEvent('stopped')])
                expectedErrorScope = {
                    name: 'Warning',
                    type: 'Warning',
                    message: '"Illegal offset type"',
                }
                if (!process.env['XDEBUG_VERSION'] || semver.gte(process.env['XDEBUG_VERSION'], '2.3.0')) {
                    expectedErrorScope.code = '2'
                }
                assert.deepEqual(await getErrorScope(), expectedErrorScope)
                await Promise.all([client.continueRequest({ threadId: threadId! }), client.waitForEvent('stopped')])
                assert.deepEqual(await getErrorScope(), {
                    name: 'Exception',
                    type: 'Exception',
                    message: '"this is an exception"',
                })
                await Promise.all([client.continueRequest({ threadId: threadId! }), client.waitForEvent('stopped')])
                const fatalErrorScope = await getErrorScope()
                assert.propertyVal(fatalErrorScope, 'name', 'Fatal error')
                assert.propertyVal(fatalErrorScope, 'type', 'Fatal error')
                assert.match(fatalErrorScope.message!, /^"Uncaught Exception/i)
                assert.match(fatalErrorScope.message!, /this is an exception/)
                assert.match(fatalErrorScope.message!, /"$/)
            })
        })

        describe('conditional breakpoints', () => {
            const program = path.join(TEST_PROJECT, 'variables.php')

            it('should stop on a conditional breakpoint when condition is true', async () => {
                await Promise.all([client.launch({ program }), client.waitForEvent('initialized')])
                const bp = (
                    await client.setBreakpointsRequest({
                        breakpoints: [{ line: 10, condition: '$anInt === 123' }],
                        source: { path: program },
                    })
                ).body.breakpoints[0]
                await waitForBreakpointUpdate(bp)
                assert.equal(bp.verified, true, 'breakpoint verification mismatch: verified')
                assert.equal(bp.line, 10, 'breakpoint verification mismatch: line')
                const [, { frame }] = await Promise.all([
                    client.configurationDoneRequest(),
                    assertStoppedLocation('breakpoint', program, 10),
                ])
                const result = (
                    await client.evaluateRequest({
                        context: 'watch',
                        frameId: frame.id,
                        expression: '$anInt',
                    })
                ).body.result
                assert.equal(result, '123')
            })

            it('should not stop on a conditional breakpoint when condition is false', async () => {
                await Promise.all([client.launch({ program }), client.waitForEvent('initialized')])
                const bp = (
                    await client.setBreakpointsRequest({
                        breakpoints: [{ line: 10, condition: '$anInt !== 123' }],
                        source: { path: program },
                    })
                ).body.breakpoints[0]
                await waitForBreakpointUpdate(bp)
                assert.equal(bp.verified, true, 'breakpoint verification mismatch: verified')
                assert.equal(bp.line, 10, 'breakpoint verification mismatch: line')
                await Promise.all([client.configurationDoneRequest(), client.waitForEvent('terminated')])
            })
        })

        describe('function breakpoints', () => {
            const program = path.join(TEST_PROJECT, 'function.php')

            it('should stop on a function breakpoint', async () => {
                await Promise.all([client.launch({ program }), client.waitForEvent('initialized')])
                const breakpoint = (
                    await client.setFunctionBreakpointsRequest({
                        breakpoints: [{ name: 'a_function' }],
                    })
                ).body.breakpoints[0]
                await waitForBreakpointUpdate(breakpoint)
                assert.strictEqual(breakpoint.verified, true)
                await Promise.all([client.configurationDoneRequest(), assertStoppedLocation('breakpoint', program, 5)])
            })
        })
    })

    describe('variables', () => {
        const program = path.join(TEST_PROJECT, 'variables.php')

        let localScope: DebugProtocol.Scope | undefined
        let superglobalsScope: DebugProtocol.Scope | undefined
        let constantsScope: DebugProtocol.Scope | undefined

        beforeEach(async () => {
            await Promise.all([
                client.launch({
                    program,
                    xdebugSettings: {
                        max_data: 10000,
                        max_children: 100,
                    },
                }),
                client.waitForEvent('initialized'),
            ])
            await client.setBreakpointsRequest({ source: { path: program }, breakpoints: [{ line: 19 }] })
            const [, event] = await Promise.all([
                client.configurationDoneRequest(),
                client.waitForEvent('stopped') as Promise<DebugProtocol.StoppedEvent>,
            ])
            const stackFrame = (await client.stackTraceRequest({ threadId: event.body.threadId! })).body.stackFrames[0]
            const scopes = (await client.scopesRequest({ frameId: stackFrame.id })).body.scopes
            localScope = scopes.find(scope => scope.name === 'Locals')
            superglobalsScope = scopes.find(scope => scope.name === 'Superglobals')
            constantsScope = scopes.find(scope => scope.name === 'User defined constants') // Xdebug >2.3 only
        })

        it('should report scopes correctly', () => {
            assert.isDefined(localScope, 'Locals')
            assert.isDefined(superglobalsScope, 'Superglobals')
            // support for user defined constants was added in 2.3.0
            if (!process.env['XDEBUG_VERSION'] || semver.gte(process.env['XDEBUG_VERSION'], '2.3.0')) {
                assert.isDefined(constantsScope, 'User defined constants')
            }
        })

        describe('local variables', () => {
            let localVariables: DebugProtocol.Variable[]

            beforeEach(async () => {
                localVariables = (await client.variablesRequest({ variablesReference: localScope!.variablesReference }))
                    .body.variables
            })

            it('should report local scalar variables correctly', async () => {
                const variables: { [name: string]: string } = Object.create(null)
                for (const variable of localVariables) {
                    variables[variable.name] = variable.value
                }
                assert.propertyVal(variables, '$aBoolean', 'true')
                assert.propertyVal(variables, '$aFloat', '1.23')
                assert.propertyVal(variables, '$aString', '"123"')
                assert.propertyVal(variables, '$anEmptyString', '""')
                assert.propertyVal(variables, '$aVeryLongString', '"' + 'lol'.repeat(1000) + '"')
                assert.propertyVal(variables, '$anInt', '123')
                assert.propertyVal(variables, '$nullValue', 'null')
                assert.propertyVal(variables, '$variableThatsNotSet', 'uninitialized')
            })

            it('should report arrays correctly', async () => {
                const anArray = localVariables.find(variable => variable.name === '$anArray')
                assert.isDefined(anArray)
                assert.propertyVal(anArray!, 'value', 'array(3)')
                assert.property(anArray!, 'variablesReference')
                const items = (await client.variablesRequest({ variablesReference: anArray!.variablesReference })).body
                    .variables
                assert.lengthOf(items, 3)
                assert.propertyVal(items[0], 'name', '0')
                assert.propertyVal(items[0], 'value', '1')
                assert.propertyVal(items[1], 'name', 'test')
                assert.propertyVal(items[1], 'value', '2')
                assert.propertyVal(items[2], 'name', 'test2')
                assert.propertyVal(items[2], 'value', 'array(1)')
                const test2Items = (await client.variablesRequest({ variablesReference: items[2].variablesReference }))
                    .body.variables
                assert.lengthOf(test2Items, 1)
                assert.propertyVal(test2Items[0], 'name', 't')
                assert.propertyVal(test2Items[0], 'value', '123')
            })

            it('should report large arrays correctly', async () => {
                const aLargeArray = localVariables.find(variable => variable.name === '$aLargeArray')
                assert.isDefined(aLargeArray)
                assert.propertyVal(aLargeArray!, 'value', 'array(100)')
                assert.property(aLargeArray!, 'variablesReference')
                const largeArrayItems = (
                    await client.variablesRequest({
                        variablesReference: aLargeArray!.variablesReference,
                    })
                ).body.variables
                assert.lengthOf(largeArrayItems, 100)
                assert.propertyVal(largeArrayItems[0], 'name', '0')
                assert.propertyVal(largeArrayItems[0], 'value', '"test"')
                assert.propertyVal(largeArrayItems[99], 'name', '99')
                assert.propertyVal(largeArrayItems[99], 'value', '"test"')
            })

            it('should report keys with spaces correctly', async () => {
                const arrayWithSpaceKey = localVariables.find(variable => variable.name === '$arrayWithSpaceKey')
                assert.isDefined(arrayWithSpaceKey)
                assert.propertyVal(arrayWithSpaceKey!, 'value', 'array(1)')
                assert.property(arrayWithSpaceKey!, 'variablesReference')
                const arrayWithSpaceKeyItems = (
                    await client.variablesRequest({
                        variablesReference: arrayWithSpaceKey!.variablesReference,
                    })
                ).body.variables
                assert.lengthOf(arrayWithSpaceKeyItems, 1)
                assert.propertyVal(arrayWithSpaceKeyItems[0], 'name', 'space key')
                assert.propertyVal(arrayWithSpaceKeyItems[0], 'value', '1')
            })

            it('should report values with null correctly', async () => {
                const arrayExtended = localVariables.find(variable => variable.name === '$arrayExtended')
                assert.isDefined(arrayExtended)
                assert.propertyVal(arrayExtended!, 'value', 'array(1)')
                assert.property(arrayExtended!, 'variablesReference')
                const arrayExtendedItems = (
                    await client.variablesRequest({
                        variablesReference: arrayExtended!.variablesReference,
                    })
                ).body.variables
                assert.lengthOf(arrayExtendedItems, 1)
                assert.propertyVal(arrayExtendedItems[0], 'name', 'a\0b')
                assert.propertyVal(arrayExtendedItems[0], 'value', '"c\0d"')
            })

            it('should report values with unicode correctly', async () => {
                const arrayExtended = localVariables.find(variable => variable.name === '$arrayExtended2')
                assert.isDefined(arrayExtended)
                assert.propertyVal(arrayExtended!, 'value', 'array(2)')
                assert.property(arrayExtended!, 'variablesReference')
                const arrayExtendedItems = (
                    await client.variablesRequest({
                        variablesReference: arrayExtended!.variablesReference,
                    })
                ).body.variables
                assert.lengthOf(arrayExtendedItems, 2)
                assert.propertyVal(arrayExtendedItems[0], 'name', 'Приветствие')
                assert.propertyVal(arrayExtendedItems[0], 'value', '"КУ-КУ"')
                assert.propertyVal(arrayExtendedItems[1], 'name', 'Прощание')
                assert.propertyVal(arrayExtendedItems[1], 'value', '"Па-Ка"')
            })
        })

        // support for user defined constants was added in 2.3.0
        if (!process.env['XDEBUG_VERSION'] || semver.gte(process.env['XDEBUG_VERSION'], '2.3.0')) {
            it('should report user defined constants correctly', async () => {
                const constants = (
                    await client.variablesRequest({
                        variablesReference: constantsScope!.variablesReference,
                    })
                ).body.variables
                assert.lengthOf(constants, 1)
                assert.propertyVal(constants[0], 'name', 'TEST_CONSTANT')
                assert.propertyVal(constants[0], 'value', '123')
            })
        }
    })

    describe('virtual sources', () => {
        it('should break on an exception inside eval code')
        it('should return the eval code with a source request')
    })

    describe('parallel requests', () => {
        it('should report multiple requests as threads')
    })

    describe('evaluation', () => {
        it('should return the eval result')
        it('should return variable references for structured results')
    })

    describe.skip('output events', () => {
        const program = path.join(TEST_PROJECT, 'output.php')

        it('stdout and stderr events should be complete and in correct order', async () => {
            await Promise.all([client.launch({ program }), client.configurationSequence()])
            await client.assertOutput('stdout', 'stdout output 1\nstdout output 2')
            await client.assertOutput('stderr', 'stderr output 1\nstderr output 2')
        })
    })
})

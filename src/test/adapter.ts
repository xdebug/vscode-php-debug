import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import * as path from 'path'
import { DebugClient } from '@vscode/debugadapter-testsupport'
import { DebugProtocol } from '@vscode/debugprotocol'
import * as semver from 'semver'
import * as net from 'net'
import * as childProcess from 'child_process'
import { describe, it, beforeEach, afterEach, after } from 'mocha'
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
            assert.equal(response.body!.supportsEvaluateForHovers, true)
            assert.equal(response.body!.supportsConditionalBreakpoints, true)
            assert.equal(response.body!.supportsFunctionBreakpoints, true)
        })
    })

    describe('launch as CLI', () => {
        const program = path.join(TEST_PROJECT, 'hello_world.php')

        it('should error on non-existing file', () =>
            assert.isRejected(
                Promise.all([client.launch({ program: 'thisfiledoesnotexist.php' }), client.configurationSequence()])
            ))

        it('should error on env without program', () =>
            assert.isRejected(Promise.all([client.launch({ env: { some: 'key' } }), client.configurationSequence()])))

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
                client.configurationSequence(),
                client.waitForEvent('terminated'),
            ]))
    })

    describe('socket path listen', () => {
        const program = path.join(TEST_PROJECT, 'hello_world.php')

        it('should error on port and socketPath', () =>
            assert.isRejected(
                Promise.all([client.launch({ port: 9003, hostname: 'unix:///test' }), client.configurationSequence()])
            ))
        ;(process.platform === 'win32' ? it : it.skip)('should listen on windows pipe', async () => {
            await Promise.all([
                client.launch({ program, hostname: '\\\\?\\pipe\\test' }),
                client.configurationSequence(),
            ])
            await client.disconnectRequest()
        })
        ;(process.platform === 'win32' ? it.skip : it)('should listen on unix pipe', async () => {
            await Promise.all([
                client.launch({
                    program,
                    hostname: 'unix:///tmp/test',
                    runtimeArgs: ['-dxdebug.client_host=unix:///tmp/text'],
                }),
                client.configurationSequence(),
                client.waitForEvent('terminated'),
            ])
        })
        ;(process.platform === 'win32' ? it.skip : it)('should error on existing unix pipe', async () => {
            await assert.isRejected(
                client.launch({
                    program,
                    hostname: 'unix:///tmp',
                    runtimeArgs: ['-dxdebug.client_host=unix:///tmp'],
                }),
                /File .+ exists and cannot be used for Unix Domain socket/
            )
        })
    })

    describe('continuation commands', () => {
        const program = path.join(TEST_PROJECT, 'function.php')

        it('should handle run')
        it('should handle step_over')
        it('should handle step_in')
        it('should handle step_out')

        it('should error on pause request', () => assert.isRejected(client.pauseRequest({ threadId: 1 })))

        it('should handle disconnect', async () => {
            await Promise.all([client.launch({ program, stopOnEntry: true }), client.configurationSequence()])
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
                const event = (await client.waitForEvent('breakpoint')) as DebugProtocol.BreakpointEvent
                if (event.body.breakpoint.id === breakpoint.id) {
                    Object.assign(breakpoint, event.body.breakpoint)
                    break
                }
            }
        }

        describe('line breakpoints', () => {
            async function testBreakpointHit(program: string, line: number): Promise<void> {
                await client.launch({ program })
                const breakpoint = (
                    await client.setBreakpointsRequest({
                        breakpoints: [{ line }],
                        source: { path: program },
                    })
                ).body.breakpoints[0]
                await client.configurationDoneRequest(), await waitForBreakpointUpdate(breakpoint)
                assert.isTrue(breakpoint.verified, 'breakpoint verification mismatch: verified')
                assert.equal(breakpoint.line, line, 'breakpoint verification mismatch: line')
                await assertStoppedLocation('breakpoint', program, line)
            }

            it('should stop on a breakpoint', () => testBreakpointHit(program, 4))

            it('should stop on a breakpoint in file with spaces in its name', () =>
                testBreakpointHit(path.join(TEST_PROJECT, 'folder with spaces', 'file with spaces.php'), 4))

            it('should stop on a breakpoint identical to the entrypoint', () => testBreakpointHit(program, 3))

            it('should support removing a breakpoint', async () => {
                await client.launch({ program })
                // set two breakpoints
                let breakpoints = (
                    await client.setBreakpointsRequest({
                        breakpoints: [{ line: 3 }, { line: 5 }],
                        source: { path: program },
                    })
                ).body.breakpoints
                await client.configurationDoneRequest(), await waitForBreakpointUpdate(breakpoints[0])
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
                await client.launch({ program, ignore: ['**/*.*'] })
                await client.setExceptionBreakpointsRequest({ filters: ['*'] })
                await Promise.all([client.configurationDoneRequest(), client.waitForEvent('terminated')])
            })

            it('should not break on exception that matches the ignore pattern', async () => {
                const program = path.join(TEST_PROJECT, 'ignore_exception.php')

                await client.launch({ program, ignoreExceptions: ['NS1\\NS2\\IgnoreException'] })
                await client.setExceptionBreakpointsRequest({ filters: ['*'] })
                await Promise.all([client.configurationDoneRequest(), client.waitForEvent('terminated')])
            })

            it('should support stopping only on a notice', async () => {
                await client.launch({ program })
                await client.setExceptionBreakpointsRequest({ filters: ['Notice'] })
                const [, { threadId }] = await Promise.all([
                    client.configurationDoneRequest(),
                    assertStoppedLocation('exception', program, 6),
                ])
                await Promise.all([client.continueRequest({ threadId }), client.waitForEvent('terminated')])
            })

            it('should support stopping only on a warning', async () => {
                await client.launch({ program })
                await client.setExceptionBreakpointsRequest({ filters: ['Warning'] })
                const [{ threadId }] = await Promise.all([
                    assertStoppedLocation('exception', program, 9),
                    client.configurationDoneRequest(),
                ])
                await Promise.all([client.continueRequest({ threadId }), client.waitForEvent('terminated')])
            })

            it('should support stopping only on an error')

            it('should support stopping only on an exception', async () => {
                await client.launch({ program })
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
                    await client.launch({ program })
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
                await client.launch({ program })
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
                await client.launch({ program })
                const bp = (
                    await client.setBreakpointsRequest({
                        breakpoints: [{ line: 10, condition: '$anInt === 123' }],
                        source: { path: program },
                    })
                ).body.breakpoints[0]
                await client.configurationDoneRequest()
                await waitForBreakpointUpdate(bp)
                assert.equal(bp.verified, true, 'breakpoint verification mismatch: verified')
                assert.equal(bp.line, 10, 'breakpoint verification mismatch: line')
                const { frame } = await assertStoppedLocation('breakpoint', program, 10)
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
                await client.launch({ program })
                const bp = (
                    await client.setBreakpointsRequest({
                        breakpoints: [{ line: 10, condition: '$anInt !== 123' }],
                        source: { path: program },
                    })
                ).body.breakpoints[0]
                await client.configurationDoneRequest()
                await waitForBreakpointUpdate(bp)
                assert.equal(bp.verified, true, 'breakpoint verification mismatch: verified')
                assert.equal(bp.line, 10, 'breakpoint verification mismatch: line')
                await client.waitForEvent('terminated')
            })
        })

        describe('function breakpoints', () => {
            const program = path.join(TEST_PROJECT, 'function.php')

            it('should stop on a function breakpoint', async () => {
                await client.launch({ program })
                const breakpoint = (
                    await client.setFunctionBreakpointsRequest({
                        breakpoints: [{ name: 'a_function' }],
                    })
                ).body.breakpoints[0]
                await client.configurationDoneRequest()
                await waitForBreakpointUpdate(breakpoint)
                assert.strictEqual(breakpoint.verified, true)
                await assertStoppedLocation('breakpoint', program, 5)
            })
        })

        describe('hit count breakpoints', () => {
            const program = path.join(TEST_PROJECT, 'hit.php')

            async function testHits(condition: string, hits: string[], verified: boolean = true): Promise<void> {
                await client.launch({ program })
                const breakpoint = (
                    await client.setBreakpointsRequest({
                        breakpoints: [{ line: 4, hitCondition: condition }],
                        source: { path: program },
                    })
                ).body.breakpoints[0]
                await client.configurationDoneRequest()
                if (verified) {
                    await waitForBreakpointUpdate(breakpoint)
                } else {
                    assert.strictEqual(
                        breakpoint.message,
                        'Invalid hit condition. Specify a number, optionally prefixed with one of the operators >= (default), == or %'
                    )
                }
                assert.strictEqual(breakpoint.verified, verified)
                for (const hitVal of hits) {
                    const { threadId, frame } = await assertStoppedLocation('breakpoint', program, 4)
                    const result = (
                        await client.evaluateRequest({
                            context: 'watch',
                            frameId: frame.id,
                            expression: '$i',
                        })
                    ).body.result
                    assert.equal(result, hitVal)
                    await client.continueRequest({ threadId })
                }
                await client.waitForEvent('terminated')
            }

            async function testFunctionHits(
                condition: string,
                hits: string[],
                verified: boolean = true
            ): Promise<void> {
                await client.launch({ program })
                const breakpoint = (
                    await client.setFunctionBreakpointsRequest({
                        breakpoints: [{ name: 'f1', hitCondition: condition }],
                    })
                ).body.breakpoints[0]
                await client.configurationDoneRequest()
                if (verified) {
                    await waitForBreakpointUpdate(breakpoint)
                } else {
                    assert.strictEqual(
                        breakpoint.message,
                        'Invalid hit condition. Specify a number, optionally prefixed with one of the operators >= (default), == or %'
                    )
                }
                assert.strictEqual(breakpoint.verified, verified)
                for (const hitVal of hits) {
                    const { threadId, frame } = await assertStoppedLocation('breakpoint', program, 9)
                    const result = (
                        await client.evaluateRequest({
                            context: 'watch',
                            frameId: frame.id,
                            expression: '$i',
                        })
                    ).body.result
                    assert.equal(result, hitVal)
                    await client.continueRequest({ threadId })
                }
                await client.waitForEvent('terminated')
            }

            describe('hit count line breakpoints', () => {
                it('should not stop for broken condition "a"', async () => {
                    await testHits('a', [], false)
                })
                it('should stop when the hit count is gte than 3 with condition "3"', async () => {
                    await testHits('3', ['3'])
                })
                it('should stop when the hit count is gte than 3 with condition ">=3"', async () => {
                    await testHits('>=3', ['3', '4', '5'])
                })
                it('should stop when the hit count is equal to 3 with condition "==3"', async () => {
                    await testHits('==3', ['3'])
                })
                it('should stop on every 2nd hit with condition "%2"', async () => {
                    await testHits('%2', ['2', '4'])
                })
            })

            describe('hit count function breakpoints', () => {
                it('should not stop for broken condition "a"', async () => {
                    await testFunctionHits('a', [], false)
                })
                it('should stop when the hit count is gte than 3 with condition "3"', async () => {
                    await testFunctionHits('3', ['3'])
                })
                it('should stop when the hit count is gte than 3 with condition ">=3"', async () => {
                    await testFunctionHits('>=3', ['3', '4', '5'])
                })
                it('should stop when the hit count is equal to 3 with condition "==3"', async () => {
                    await testFunctionHits('==3', ['3'])
                })
                it('should stop on every 2nd hit with condition "%2"', async () => {
                    await testFunctionHits('%2', ['2', '4'])
                })
            })
        })
    })

    describe('variables', () => {
        const program = path.join(TEST_PROJECT, 'variables.php')

        let localScope: DebugProtocol.Scope | undefined
        let superglobalsScope: DebugProtocol.Scope | undefined
        let constantsScope: DebugProtocol.Scope | undefined

        beforeEach(async () => {
            await client.launch({
                program,
                xdebugSettings: {
                    max_data: 10000,
                    max_children: 100,
                },
            })
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

            it('should report local scalar variables correctly', () => {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

    describe('setVariables', () => {
        const program = path.join(TEST_PROJECT, 'variables.php')

        let localScope: DebugProtocol.Scope | undefined
        let localVariables: DebugProtocol.Variable[]
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        let variables: { [name: string]: string } = Object.create(null)

        beforeEach(async () => {
            await client.launch({ program })
            await client.setBreakpointsRequest({ source: { path: program }, breakpoints: [{ line: 19 }] })
            const [, event] = await Promise.all([
                client.configurationDoneRequest(),
                client.waitForEvent('stopped') as Promise<DebugProtocol.StoppedEvent>,
            ])
            const stackFrame = (await client.stackTraceRequest({ threadId: event.body.threadId! })).body.stackFrames[0]
            const scopes = (await client.scopesRequest({ frameId: stackFrame.id })).body.scopes
            localScope = scopes.find(scope => scope.name === 'Locals')
        })

        async function getLocals() {
            localVariables = (await client.variablesRequest({ variablesReference: localScope!.variablesReference }))
                .body.variables
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            variables = Object.create(null)
            for (const variable of localVariables) {
                variables[variable.name] = variable.value
            }
        }

        it('should set the value of an integer', async () => {
            await getLocals()
            assert.propertyVal(variables, '$anInt', '123')
            await client.setVariableRequest({
                variablesReference: localScope!.variablesReference,
                name: '$anInt',
                value: '100',
            })
            await getLocals()
            assert.propertyVal(variables, '$anInt', '100')
        })
        it('should set the value of a string', async () => {
            await getLocals()
            assert.propertyVal(variables, '$aString', '"123"')
            await client.setVariableRequest({
                variablesReference: localScope!.variablesReference,
                name: '$aString',
                value: '"aaaa"',
            })
            await getLocals()
            assert.propertyVal(variables, '$aString', '"aaaa"')
        })
        it('should set the value of an nested property', async () => {
            await getLocals()
            let anArray = localVariables.find(variable => variable.name === '$anArray')
            assert.propertyVal(anArray!, 'value', 'array(3)')
            await client.setVariableRequest({
                variablesReference: localScope!.variablesReference,
                name: '$anArray',
                value: 'array(1,2)',
            })
            await getLocals()
            anArray = localVariables.find(variable => variable.name === '$anArray')
            assert.propertyVal(anArray!, 'value', 'array(2)')
        })
    })

    describe('virtual sources', () => {
        it('should break on an exception inside eval code')
        it('should return the eval code with a source request')
    })

    describe('parallel requests', () => {
        it('should report multiple requests as threads')
    })

    describe('evaluation', () => {
        it('should return the eval result', async () => {
            const program = path.join(TEST_PROJECT, 'variables.php')

            await client.launch({
                program,
            })
            await client.setBreakpointsRequest({ source: { path: program }, breakpoints: [{ line: 19 }] })
            await client.configurationDoneRequest()
            const { frame } = await assertStoppedLocation('breakpoint', program, 19)

            const response = (
                await client.evaluateRequest({
                    context: 'hover',
                    frameId: frame.id,
                    expression: '$anInt',
                })
            ).body

            assert.equal(response.result, '123')
            assert.equal(response.variablesReference, 0)
        })
        it('should return variable references for structured results', async () => {
            const program = path.join(TEST_PROJECT, 'variables.php')

            await client.launch({
                program,
            })
            await client.setBreakpointsRequest({ source: { path: program }, breakpoints: [{ line: 19 }] })
            await client.configurationDoneRequest()
            const { frame } = await assertStoppedLocation('breakpoint', program, 19)

            const response = (
                await client.evaluateRequest({
                    context: 'hover',
                    frameId: frame.id,
                    expression: '$anArray',
                })
            ).body

            assert.equal(response.result, 'array(3)')
            assert.notEqual(response.variablesReference, 0)
            const vars = await client.variablesRequest({ variablesReference: response.variablesReference })
            assert.deepEqual(vars.body.variables[0].name, '0')
            assert.deepEqual(vars.body.variables[0].value, '1')
        })
    })

    describe.skip('output events', () => {
        const program = path.join(TEST_PROJECT, 'output.php')

        it('stdout and stderr events should be complete and in correct order', async () => {
            await Promise.all([client.launch({ program }), client.configurationSequence()])
            await client.assertOutput('stdout', 'stdout output 1\nstdout output 2')
            await client.assertOutput('stderr', 'stderr output 1\nstderr output 2')
        })
    })

    describe('stream tests', () => {
        const program = path.join(TEST_PROJECT, 'output.php')

        it('listen with externalConsole', async () => {
            // this is how we can currently turn on stdout redirect
            await Promise.all([client.launch({ stream: { stdout: '1' } }), client.configurationSequence()])

            const script = childProcess.spawn('php', [program])
            after(() => script.kill())
            await client.assertOutput('stdout', 'stdout output 1')
            await client.assertOutput('stdout', 'stdout output 2')
        })
    })

    describe('special adapter tests', () => {
        it('max connections', async () => {
            await Promise.all([client.launch({ maxConnections: 1, log: true }), client.configurationSequence()])

            const s1 = net.createConnection({ port: 9003 })
            const o1 = await client.assertOutput('console', 'new connection')
            assert.match(
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                o1.body.output as string,
                /^new connection \d+ from/
            )
            net.createConnection({ port: 9003 })
            const o = await client.waitForEvent('output')
            assert.match(
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                o.body.output as string,
                /^new connection from .* - dropping due to max connection limit/,
                'Second connection does not generate proper error output'
            )
            await new Promise(resolve => {
                s1.on('close', resolve)
                s1.end()
            })
        })
        it('stack depth', async () => {
            const program = path.join(TEST_PROJECT, 'stack.php')

            await Promise.all([client.launch({ program }), client.configurationSequence()])
            const event = (await client.waitForEvent('stopped')) as DebugProtocol.StoppedEvent
            assert.propertyVal(event.body, 'reason', 'breakpoint')
            const threadId = event.body.threadId!

            const response = await client.stackTraceRequest({ threadId, levels: 1 })
            assert.lengthOf(response.body.stackFrames, 1)
            assert.equal(response.body.totalFrames, 4)
            assert.equal(response.body.stackFrames[0].name, 'depth3')
            const response2 = await client.stackTraceRequest({ threadId, startFrame: 1 /* , levels: 3*/ })
            assert.lengthOf(response2.body.stackFrames, 3)
            assert.equal(response2.body.totalFrames, 4)
            assert.equal(response2.body.stackFrames[0].name, 'depth2')
            assert.equal(response2.body.stackFrames[1].name, 'depth1')
            assert.equal(response2.body.stackFrames[2].name, '{main}')
        })
        it('skip entry paths', async () => {
            const program = path.join(TEST_PROJECT, 'variables.php')

            await client.launch({ program, skipEntryPaths: ['**/variables.php'] })
            await client.setBreakpointsRequest({ source: { path: program }, breakpoints: [{ line: 19 }] })
            await client.configurationDoneRequest()

            await client.assertOutput('console', 'skipping entry point')
        })
    })
})

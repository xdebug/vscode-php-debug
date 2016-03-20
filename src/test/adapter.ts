import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as path from 'path';
import {DebugClient} from './debugClient';
chai.use(chaiAsPromised);
const assert = chai.assert;

describe('PHP Debug Adapter', () => {

    const TEST_PROJECT = path.normalize(__dirname + '/../../testproject');

    let client: DebugClient;

    beforeEach(async () => {
        client = new DebugClient('node', path.normalize(__dirname + '/../phpDebug'), 'php');
        await client.start();
    });

    afterEach(() => client.stop());

    describe('initialization', () => {

        it('should return supported features', async () => {
            const response = await client.initializeRequest();
            assert.equal(response.body.supportsConfigurationDoneRequest, true);
            assert.equal(response.body.supportsEvaluateForHovers, false);
            assert.equal(response.body.supportsConditionalBreakpoints, true);
            assert.equal(response.body.supportsFunctionBreakpoints, true);
        });
    });

    describe('launch as CLI', () => {

        const program = path.join(TEST_PROJECT, 'hello_world.php');

        it('should error on non-existing file', () =>
            assert.isRejected(client.launch({program: 'thisfiledoesnotexist.php'}))
        );

        it('should run program to the end', () =>
            Promise.all([
                client.launch({program}),
                client.configurationSequence(),
                client.waitForEvent('terminated')
            ])
        );

        it('should stop on entry', () =>
            Promise.all([
                client.launch({program, stopOnEntry: true}),
                client.configurationSequence(),
                client.assertStoppedLocation('entry', {path: program, line: 3})
            ])
        );
    });

    describe('continuation commands', () => {

        const program = path.join(TEST_PROJECT, 'function.php');

        it('should handle run');
        it('should handle step_over');
        it('should handle step_in');
        it('should handle step_out');
        it('should handle disconnect', async () => {
            await Promise.all([
                client.launch({program, stopOnEntry: true}),
                client.waitForEvent('initialized')
            ]);
            await client.disconnectRequest();
        });
    });

    describe('breakpoints', () => {

        const program = path.join(TEST_PROJECT, 'hello_world.php');

        describe('line breakpoints', () => {

            it('should stop on a breakpoint', () =>
                client.hitBreakpoint({program}, {path: program, line: 4})
            );

            it('should stop on a breakpoint in file with spaces in its name', () =>
                client.hitBreakpoint({program}, {path: program, line: 4})
            );

            it('should stop on a breakpoint identical to the entrypoint', () =>
                client.hitBreakpoint({program}, {path: program, line: 3})
            );
        });

        describe('exception breakpoints', () => {

            const program = path.join(TEST_PROJECT, 'error.php');

            beforeEach(() => Promise.all([
                client.launch({program}),
                client.waitForEvent('initialized')
            ]));

            it('should support stopping only on a notice', async () => {
                await client.setExceptionBreakpointsRequest({filters: ['Notice']});
                await Promise.all([
                    client.configurationDoneRequest(),
                    client.assertStoppedLocation('exception', {path: program, line: 6})
                ]);
                await Promise.all([
                    client.continueRequest({threadId: 1}),
                    client.waitForEvent('terminated')
                ]);
            });

            it('should support stopping only on a warning', async () => {
                await client.setExceptionBreakpointsRequest({filters: ['Warning']});
                await Promise.all([
                    client.assertStoppedLocation('exception', {path: program, line: 9}),
                    client.configurationDoneRequest()
                ]);
                await Promise.all([
                    client.continueRequest({threadId: 1}),
                    client.waitForEvent('terminated')
                ]);
            });

            it('should support stopping only on an exception', async () => {
                await client.setExceptionBreakpointsRequest({filters: ['Exception']});
                await Promise.all([
                    client.configurationDoneRequest(),
                    client.assertStoppedLocation('exception', {path: program, line: 12})
                ]);
                await Promise.all([
                    client.continueRequest({threadId: 1}),
                    client.waitForEvent('terminated')
                ]);
            });

            it('should support stopping on everything', async () => {
                await client.setExceptionBreakpointsRequest({filters: ['*']});
                // Notice
                await Promise.all([
                    client.configurationDoneRequest(),
                    client.assertStoppedLocation('exception', {path: program, line: 6})
                ]);
                // Warning
                await Promise.all([
                    client.continueRequest({threadId: 1}),
                    client.assertStoppedLocation('exception', {path: program, line: 9})
                ]);
                // Exception
                await Promise.all([
                    client.continueRequest({threadId: 1}),
                    client.assertStoppedLocation('exception', {path: program, line: 12})
                ]);
                // Fatal error: uncaught exception
                await Promise.all([
                    client.continueRequest({threadId: 1}),
                    client.assertStoppedLocation('exception', {path: program, line: 12})
                ]);
                await Promise.all([
                    client.continueRequest({threadId: 1}),
                    client.waitForEvent('terminated')
                ]);
            });

            it('should report the error in a virtual error scope');
        });

        describe('conditional breakpoints', () => {

            const program = path.join(TEST_PROJECT, 'variables.php');

            it('should stop on a conditional breakpoint when condition is true', async () => {
                await Promise.all([
                    client.launch({program}),
                    client.waitForEvent('initialized')
                ]);
                const bp = (await client.setBreakpointsRequest({breakpoints: [{line: 10, condition: '$anInt === 123'}], source: {path: program}})).body.breakpoints[0];
                assert.equal(bp.verified, true, 'breakpoint verification mismatch: verified');
                assert.equal(bp.line, 10, 'breakpoint verification mismatch: line');
                const frame = (await Promise.all([
                    client.configurationDoneRequest(),
                    client.assertStoppedLocation('breakpoint', {path: program, line: 10})
                ]))[1].body.stackFrames[0];
                const result = (await client.evaluateRequest({context: 'watch', frameId: frame.id, expression: '$anInt'})).body.result;
                assert.equal(result, 123);
            });

            it('should not stop on a conditional breakpoint when condition is false', async () => {
                await Promise.all([
                    client.launch({program}),
                    client.waitForEvent('initialized')
                ]);
                const bp = (await client.setBreakpointsRequest({breakpoints: [{line: 10, condition: '$anInt !== 123'}], source: {path: program}})).body.breakpoints[0];
                assert.equal(bp.verified, true, 'breakpoint verification mismatch: verified');
                assert.equal(bp.line, 10, 'breakpoint verification mismatch: line');
                await Promise.all([
                    client.configurationDoneRequest(),
                    client.waitForEvent('terminated')
                ]);
            });
        });

        describe('function breakpoints', () => {

            const program = path.join(TEST_PROJECT, 'function.php');

            it('should stop on a function breakpoint', async () => {
                await client.launch({program});
                await client.waitForEvent('initialized');
                const breakpoint = (await client.setFunctionBreakpointsRequest({breakpoints: [{name: 'a_function'}]})).body.breakpoints[0];
                assert.strictEqual(breakpoint.verified, true);
                await Promise.all([
                    client.configurationDoneRequest(),
                    client.assertStoppedLocation('breakpoint', {path: program, line: 5})
                ]);
            });
        });
    });

    describe('variables', () => {

        const program = path.join(TEST_PROJECT, 'variables.php');

        it('should report all variables correctly', async () => {
            await Promise.all([
                client.launch({program}),
                client.waitForEvent('initialized')
            ]);
            await client.setBreakpointsRequest({source: {path: program}, breakpoints: [{line: 15}]});
            await Promise.all([
                client.configurationDoneRequest(),
                client.waitForEvent('stopped')
            ]);
            const stackFrame = (await client.stackTraceRequest({threadId: 1})).body.stackFrames[0];
            const [localScope, superglobalsScope, constantsScope] = (await client.scopesRequest({frameId: stackFrame.id})).body.scopes;

            assert.isDefined(localScope);
            assert.propertyVal(localScope, 'name', 'Locals');
            const variables = (await client.variablesRequest({variablesReference: localScope.variablesReference})).body.variables;
            assert.lengthOf(variables, 9);

            const [aBoolean, aFloat, aLargeArray, aString, anArray, anEmptyString, anInt, nullValue, variableThatsNotSet] = variables;

            assert.propertyVal(aBoolean, 'name', '$aBoolean');
            assert.propertyVal(aBoolean, 'value', 'true');
            assert.propertyVal(aFloat, 'name', '$aFloat');
            assert.propertyVal(aFloat, 'value', '1.23');
            assert.propertyVal(aString, 'name', '$aString');
            assert.propertyVal(aString, 'value', '"123"');
            assert.propertyVal(anEmptyString, 'name', '$anEmptyString');
            assert.propertyVal(anEmptyString, 'value', '""');
            assert.propertyVal(anInt, 'name', '$anInt');
            assert.propertyVal(anInt, 'value', '123');
            assert.propertyVal(nullValue, 'name', '$nullValue');
            assert.propertyVal(nullValue, 'value', 'null');
            assert.propertyVal(variableThatsNotSet, 'name', '$variableThatsNotSet');
            assert.propertyVal(variableThatsNotSet, 'value', 'uninitialized');

            assert.propertyVal(anArray, 'name', '$anArray');
            assert.propertyVal(anArray, 'value', 'array(2)');
            assert.property(anArray, 'variablesReference');
            const items = (await client.variablesRequest({variablesReference: anArray.variablesReference})).body.variables;
            assert.lengthOf(items, 2);
            assert.propertyVal(items[0], 'name', '0');
            assert.propertyVal(items[0], 'value', '1');
            assert.propertyVal(items[1], 'name', 'test');
            assert.propertyVal(items[1], 'value', '2');

            assert.propertyVal(aLargeArray, 'name', '$aLargeArray');
            assert.propertyVal(aLargeArray, 'value', 'array(100)');
            assert.property(aLargeArray, 'variablesReference');
            const largeArrayItems = (await client.variablesRequest({variablesReference: aLargeArray.variablesReference})).body.variables;
            assert.lengthOf(largeArrayItems, 100);
            assert.propertyVal(largeArrayItems[0], 'name', '0');
            assert.propertyVal(largeArrayItems[0], 'value', '"test"');
            assert.propertyVal(largeArrayItems[99], 'name', '99');
            assert.propertyVal(largeArrayItems[99], 'value', '"test"');

            assert.isDefined(superglobalsScope);
            assert.propertyVal(superglobalsScope, 'name', 'Superglobals');

            assert.isDefined(constantsScope);
            assert.propertyVal(constantsScope, 'name', 'User defined constants');
            const constants = (await client.variablesRequest({variablesReference: constantsScope.variablesReference})).body.variables;
            assert.lengthOf(constants, 1);
            assert.propertyVal(constants[0], 'name', 'TEST_CONSTANT');
            assert.propertyVal(constants[0], 'value', '123');
        });
    });

    describe('virtual sources', () => {
        it('should break on an exception inside eval code');
        it('should return the eval code with a source request');
    });

    describe('parallel requests', () => {
        it('should report multiple requests as threads');
    });

    describe('evaluation', () => {
        it('should return the eval result');
        it('should return variable references for structured results');
    });

    describe.skip('output events', () => {

        const program = path.join(TEST_PROJECT, 'output.php');

        it('stdout and stderr events should be complete and in correct order', async () => {
            await Promise.all([
                client.launch({program}),
                client.configurationSequence()
            ]);
            await client.assertOutput('stdout', 'stdout output 1\nstdout output 2');
            await client.assertOutput('stderr', 'stderr output 1\nstderr output 2');
        });
    });
});

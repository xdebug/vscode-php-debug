import * as vscode from 'vscode-debugadapter';
import {DebugProtocol as VSCodeDebugProtocol} from 'vscode-debugprotocol';
import * as net from 'net';
import * as xdebug from './xdebugConnection';
import moment from 'moment';
import * as url from 'url';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as util from 'util';
import * as fs from 'fs';
import {Terminal} from './terminal';
import {isSameUri, convertClientPathToDebugger, convertDebuggerPathToClient} from './paths';
import * as semver from 'semver';

if (process.env.VSCODE_NLS_CONFIG) {
    try {
        moment.locale(JSON.parse(process.env.VSCODE_NLS_CONFIG).locale);
    } catch (e) {
        // ignore
    }
}

/** formats a xdebug property value for VS Code */
function formatPropertyValue(property: xdebug.BaseProperty): string {
    let displayValue: string;
    if (property.hasChildren || property.type === 'array' || property.type === 'object') {
        if (property.type === 'array') {
            // for arrays, show the length, like a var_dump would do
            displayValue = 'array(' + (property.hasChildren ? property.numberOfChildren : 0) + ')';
        } else if (property.type === 'object' && property.class) {
            // for objects, show the class name as type (if specified)
            displayValue = property.class;
        } else {
            // edge case: show the type of the property as the value
            displayValue = property.type;
        }
    } else {
        // for null, uninitialized, resource, etc. show the type
        displayValue = property.value || property.type === 'string' ? property.value : property.type;
        if (property.type === 'string') {
            displayValue = '"' + displayValue + '"';
        } else if (property.type === 'bool') {
            displayValue = !!parseInt(displayValue) + '';
        }
    }
    return displayValue;
}

/**
 * This interface should always match the schema found in the mock-debug extension manifest.
 */
interface LaunchRequestArguments extends VSCodeDebugProtocol.LaunchRequestArguments {
    /** The port where the adapter should listen for XDebug connections (default: 9000) */
    port?: number;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
    /** The source root on the server when doing remote debugging on a different host */
    serverSourceRoot?: string;
    /** The path to the source root on this machine that is the equivalent to the serverSourceRoot on the server. */
    localSourceRoot?: string;
    /** If true, will log all communication between VS Code and the adapter to the console */
    log?: boolean;

    // CLI options

    /** If set, launches the specified PHP script in CLI mode */
    program?: string;
    /** Optional arguments passed to the debuggee. */
    args?: string[];
    /** Launch the debuggee in this working directory (specified as an absolute path). If omitted the debuggee is lauched in its own directory. */
    cwd?: string;
    /** Absolute path to the runtime executable to be used. Default is the runtime executable on the PATH. */
    runtimeExecutable?: string;
    /** Optional arguments passed to the runtime executable. */
    runtimeArgs?: string[];
    /** Optional environment variables to pass to the debuggee. The string valued properties of the 'environmentVariables' are used as key/value pairs. */
    env?: { [key: string]: string; };
    /** If true launch the target in an external console. */
    externalConsole?: boolean;
}

class PhpDebugSession extends vscode.DebugSession {

    /** The arguments that were given to launchRequest */
    private _args: LaunchRequestArguments;

    /** The TCP server that listens for XDebug connections */
    private _server: net.Server;

    /**
     * A map from VS Code thread IDs to XDebug Connections.
     * XDebug makes a new connection for each request to the webserver, we present these as threads to VS Code.
     * The threadId key is equal to the id attribute of the connection.
     */
    private _connections = new Map<number, xdebug.Connection>();

    /** A set of connections which are not yet running and are waiting for configurationDoneRequest */
    private _waitingConnections = new Set<xdebug.Connection>();

    /** A counter for unique source IDs */
    private _sourceIdCounter = 1;

    /** A map of VS Code source IDs to XDebug file URLs for virtual files (dpgp://whatever) and the corresponding connection */
    private _sources = new Map<number, {connection: xdebug.Connection, url: string}>();

    /** A counter for unique stackframe IDs */
    private _stackFrameIdCounter = 1;

    /** A map from unique stackframe IDs (even across connections) to XDebug stackframes */
    private _stackFrames = new Map<number, xdebug.StackFrame>();

    /** A map from XDebug connections to their current status */
    private _statuses = new Map<xdebug.Connection, xdebug.StatusResponse>();

    /** A counter for unique context, property and eval result properties (as these are all requested by a VariableRequest from VS Code) */
    private _variableIdCounter = 1;

    /** A map from unique VS Code variable IDs to XDebug statuses for virtual error stack frames */
    private _errorStackFrames = new Map<number, xdebug.StatusResponse>();

    /** A map from unique VS Code variable IDs to XDebug statuses for virtual error scopes */
    private _errorScopes = new Map<number, xdebug.StatusResponse>();

    /** A map from unique VS Code variable IDs to an XDebug contexts */
    private _contexts = new Map<number, xdebug.Context>();

    /** A map from unique VS Code variable IDs to a XDebug properties */
    private _properties = new Map<number, xdebug.Property>();

    /** A map from unique VS Code variable IDs to XDebug eval result properties, because property children returned from eval commands are always inlined */
    private _evalResultProperties = new Map<number, xdebug.EvalResultProperty>();

    public constructor() {
        super();
        this.setDebuggerColumnsStartAt1(true);
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerPathFormat('uri');
    }

    protected initializeRequest(response: VSCodeDebugProtocol.InitializeResponse, args: VSCodeDebugProtocol.InitializeRequestArguments): void {
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = false;
        response.body.supportsConditionalBreakpoints = true;
        response.body.supportsFunctionBreakpoints = true;
        response.body.exceptionBreakpointFilters = [
            {
                filter: 'Notice',
                label: 'Notices'
            },
            {
                filter: 'Warning',
                label: 'Warnings'
            },
            {
                filter: 'Exception',
                label: 'Exceptions'
            },
            {
                filter: '*',
                label: 'Everything',
                default: true
            }
        ];
        this.sendResponse(response);
    }

    protected attachRequest(response: VSCodeDebugProtocol.AttachResponse, args: VSCodeDebugProtocol.AttachRequestArguments) {
        this.sendErrorResponse(response, new Error('Attach requests are not supported'));
        this.shutdown();
    }

    protected async launchRequest(response: VSCodeDebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        this._args = args;
        /** launches the script as CLI */
        const launchScript = async () => {
            // check if program exists
            await new Promise((resolve, reject) => fs.access(args.program, fs.F_OK, err => err ? reject(err) : resolve()));
            const runtimeArgs = args.runtimeArgs || [];
            const runtimeExecutable = args.runtimeExecutable || 'php';
            const programArgs = args.args || [];
            const cwd = args.cwd || process.cwd();
            const env = args.env || process.env;
            // launch in CLI mode
            if (args.externalConsole) {
                const script = await Terminal.launchInTerminal(cwd, [runtimeExecutable, ...runtimeArgs, args.program, ...programArgs], env);
                // we only do this for CLI mode. In normal listen mode, only a thread exited event is send.
                script.on('exit', () => {
                    this.sendEvent(new vscode.TerminatedEvent());
                });
            } else {
                const script = childProcess.spawn(runtimeExecutable, [...runtimeArgs, args.program, ...programArgs], {cwd, env});
                // redirect output to debug console
                script.stdout.on('data', (data: Buffer) => {
                    this.sendEvent(new vscode.OutputEvent(data + '', 'stdout'));
                });
                script.stderr.on('data', (data: Buffer) => {
                    this.sendEvent(new vscode.OutputEvent(data + '', 'stderr'));
                });
                // we only do this for CLI mode. In normal listen mode, only a thread exited event is send.
                script.on('exit', () => {
                    this.sendEvent(new vscode.TerminatedEvent());
                });
                script.on('error', (error: Error) => {
                    this.sendEvent(new vscode.OutputEvent(error.message));
                });
            }
        };
        /** sets up a TCP server to listen for XDebug connections */
        const createServer = () => new Promise((resolve, reject) => {
            const server = this._server = net.createServer();
            server.on('connection', async (socket: net.Socket) => {
                try {
                    // new XDebug connection
                    const connection = new xdebug.Connection(socket);
                    if (args.log) {
                        this.sendEvent(new vscode.OutputEvent('new connection ' + connection.id + '\n'), true);
                    }
                    this._connections.set(connection.id, connection);
                    this._waitingConnections.add(connection);
                    const disposeConnection = (error?: Error) => {
                        if (this._connections.has(connection.id)) {
                            if (args.log) {
                                this.sendEvent(new vscode.OutputEvent('connection ' + connection.id + ' closed\n'));
                            }
                            if (error) {
                                this.sendEvent(new vscode.OutputEvent(error.message));
                            }
                            this.sendEvent(new vscode.ThreadEvent('exited', connection.id));
                            connection.close();
                            this._connections.delete(connection.id);
                            this._waitingConnections.delete(connection);
                        }
                    };
                    connection.on('warning', warning => {
                        this.sendEvent(new vscode.OutputEvent(warning));
                    });
                    connection.on('error', disposeConnection);
                    connection.on('close', disposeConnection);
                    const initPacket = await connection.waitForInitPacket();
                    this.sendEvent(new vscode.ThreadEvent('started', connection.id));
                    // set max_depth to 1 since VS Code requests nested structures individually anyway
                    await connection.sendFeatureSetCommand('max_depth', '1');
                    // raise default of 32
                    await connection.sendFeatureSetCommand('max_children', '10000');
                    // don't truncate long variable values
                    await connection.sendFeatureSetCommand('max_data', semver.lt(initPacket.engineVersion.replace(/((?:dev|alpha|beta|RC|stable)\d*)$/, '-$1'), '2.2.4') ? '10000' : '0');
                    // request breakpoints from VS Code
                    await this.sendEvent(new vscode.InitializedEvent());
                } catch (error) {
                    this.sendEvent(new vscode.OutputEvent(error instanceof Error ? error.message : error));
                }
            });
            server.on('error', (error: Error) => {
                this.sendEvent(new vscode.OutputEvent(error.message));
                this.shutdown();
            });
            server.listen(args.port || 9000, error => error ? reject(error) : resolve());
        });
        try {
            if (!args.noDebug) {
                await createServer();
            }
            if (args.program) {
                await launchScript();
            }
        } catch (error) {
            this.sendErrorResponse(response, <Error>error);
            return;
        }
        this.sendResponse(response);
    }

    /**
     * Checks the status of a StatusResponse and notifies VS Code accordingly
     * @param {xdebug.StatusResponse} response
     */
    private async _checkStatus(response: xdebug.StatusResponse) {
        const connection = response.connection;
        this._statuses.set(connection, response);
        if (response.status === 'stopping') {
            const response = await connection.sendStopCommand();
            this._checkStatus(response);
        } else if (response.status === 'stopped') {
            this._connections.delete(connection.id);
            this.sendEvent(new vscode.ThreadEvent('exited', connection.id));
            connection.close();
        } else if (response.status === 'break') {
            // StoppedEvent reason can be 'step', 'breakpoint', 'exception' or 'pause'
            let stoppedEventReason: 'step' | 'breakpoint' | 'exception' | 'pause' | 'entry';
            let exceptionText: string;
            if (response.exception) {
                stoppedEventReason = 'exception';
                exceptionText = response.exception.name + ': ' + response.exception.message; // this seems to be ignored currently by VS Code
            } else if (this._args.stopOnEntry) {
                stoppedEventReason = 'entry';
            } else if (response.command.indexOf('step') === 0) {
                stoppedEventReason = 'step';
            } else {
                stoppedEventReason = 'breakpoint';
            }
            const event: VSCodeDebugProtocol.StoppedEvent = new vscode.StoppedEvent(stoppedEventReason, connection.id, exceptionText);
            event.body.allThreadsStopped = false;
            this.sendEvent(event);
        }
    }

    /** Logs all requests before dispatching */
    protected dispatchRequest(request: VSCodeDebugProtocol.Request): void {
        if (this._args && this._args.log) {
            const log = `-> ${request.command}Request\n${util.inspect(request, {depth: null})}\n\n`;
            super.sendEvent(new vscode.OutputEvent(log));
        }
        super.dispatchRequest(request);
    }

    public sendEvent(event: VSCodeDebugProtocol.Event, bypassLog: boolean = false): void {
        if (this._args && this._args.log && !bypassLog) {
            const log = `<- ${event.event}Event\n${util.inspect(event, {depth: null})}\n\n`;
            super.sendEvent(new vscode.OutputEvent(log));
        }
        super.sendEvent(event);
    }

    public sendResponse(response: VSCodeDebugProtocol.Response): void {
        if (this._args && this._args.log) {
            const log = `<- ${response.command}Response\n${util.inspect(response, {depth: null})}\n\n`;
            super.sendEvent(new vscode.OutputEvent(log));
        }
        super.sendResponse(response);
    }

    protected sendErrorResponse(response: VSCodeDebugProtocol.Response, error: Error, dest?: vscode.ErrorDestination): void;
    protected sendErrorResponse(response: VSCodeDebugProtocol.Response, codeOrMessage: number | VSCodeDebugProtocol.Message, format?: string, variables?: any, dest?: vscode.ErrorDestination): void;
    protected sendErrorResponse(response: VSCodeDebugProtocol.Response) {
        if (arguments[1] instanceof Error) {
            const error = arguments[1] as Error & {code?: number|string, errno?: number};
            const dest = arguments[2] as vscode.ErrorDestination;
            let code: number;
            if (typeof error.code === 'number') {
                code = error.code as number;
            } else if (typeof error.errno === 'number') {
                code = error.errno;
            } else {
                code = 0;
            }
            super.sendErrorResponse(response, code, error.message, dest);
        } else {
            super.sendErrorResponse(response, arguments[1], arguments[2], arguments[3], arguments[4]);
        }
    }

    /** This is called for each source file that has breakpoints with all the breakpoints in that file and whenever these change. */
    protected async setBreakPointsRequest(response: VSCodeDebugProtocol.SetBreakpointsResponse, args: VSCodeDebugProtocol.SetBreakpointsArguments) {
        try {
            const fileUri = convertClientPathToDebugger(args.source.path, this._args.localSourceRoot, this._args.serverSourceRoot);
            const connections = Array.from(this._connections.values());
            let xdebugBreakpoints: Array<xdebug.ConditionalBreakpoint|xdebug.LineBreakpoint>;
            response.body = {breakpoints: []};
            // this is returned to VS Code
            let vscodeBreakpoints: VSCodeDebugProtocol.Breakpoint[];
            if (connections.length === 0) {
                // if there are no connections yet, we cannot verify any breakpoint
                vscodeBreakpoints = args.breakpoints.map(breakpoint => ({verified: false, line: breakpoint.line}));
            } else {
                vscodeBreakpoints = [];
                // create XDebug breakpoints from the arguments
                xdebugBreakpoints = args.breakpoints.map(breakpoint => {
                    if (breakpoint.condition) {
                        return new xdebug.ConditionalBreakpoint(breakpoint.condition, fileUri, breakpoint.line);
                    } else {
                        return new xdebug.LineBreakpoint(fileUri, breakpoint.line);
                    }
                });
                // for all connections
                await Promise.all(connections.map(async (connection, connectionIndex) => {
                    // clear breakpoints for this file
                    // in the future when VS Code returns the breakpoint IDs it would be better to calculate the diff
                    const {breakpoints} = await connection.sendBreakpointListCommand();
                    await Promise.all(
                        breakpoints
                            // filter to only include line breakpoints for this file
                            .filter(breakpoint => breakpoint instanceof xdebug.LineBreakpoint && isSameUri(fileUri, breakpoint.fileUri))
                            // remove them
                            .map(breakpoint => breakpoint.remove())
                    );
                    // set new breakpoints
                    await Promise.all(xdebugBreakpoints.map(async (breakpoint, index) => {
                        try {
                            await connection.sendBreakpointSetCommand(breakpoint);
                            // only capture each breakpoint once
                            if (connectionIndex === 0) {
                                vscodeBreakpoints[index] = {verified: true, line: breakpoint.line};
                            }
                        } catch (error) {
                            // only capture each breakpoint once
                            if (connectionIndex === 0) {
                                vscodeBreakpoints[index] = {verified: false, line: breakpoint.line, message: (<Error>error).message};
                            }
                        }
                    }));
                }));
            }
            response.body = {breakpoints: vscodeBreakpoints};
        } catch (error) {
            this.sendErrorResponse(response, error);
            return;
        }
        this.sendResponse(response);
    }

    /** This is called once after all line breakpoints have been set and whenever the breakpoints settings change */
    protected async setExceptionBreakPointsRequest(response: VSCodeDebugProtocol.SetExceptionBreakpointsResponse, args: VSCodeDebugProtocol.SetExceptionBreakpointsArguments) {
        try {
            const connections = Array.from(this._connections.values());
            await Promise.all(connections.map(async (connection) => {
                // get all breakpoints
                const {breakpoints} = await connection.sendBreakpointListCommand();
                // remove all exception breakpoints
                await Promise.all(breakpoints.filter(breakpoint => breakpoint.type === 'exception').map(breakpoint => breakpoint.remove()));
                // set new exception breakpoints
                await Promise.all(args.filters.map(filter => connection.sendBreakpointSetCommand(new xdebug.ExceptionBreakpoint(filter))));
            }));
        } catch (error) {
            this.sendErrorResponse(response, error);
            return;
        }
        this.sendResponse(response);
    }

    protected async setFunctionBreakPointsRequest(response: VSCodeDebugProtocol.SetFunctionBreakpointsResponse, args: VSCodeDebugProtocol.SetFunctionBreakpointsArguments) {
        try {
            const connections = Array.from(this._connections.values());
            // this is returned to VS Code
            let vscodeBreakpoints: VSCodeDebugProtocol.Breakpoint[];
            if (connections.length === 0) {
                // if there are no connections yet, we cannot verify any breakpoint
                vscodeBreakpoints = args.breakpoints.map(breakpoint => ({verified: false, message: 'No connection'}));
            } else {
                vscodeBreakpoints = [];
                // for all connections
                await Promise.all(connections.map(async (connection, connectionIndex) => {
                    // clear breakpoints for this file
                    const {breakpoints} = await connection.sendBreakpointListCommand();
                    await Promise.all(breakpoints.filter(breakpoint => breakpoint.type === 'call').map(breakpoint => breakpoint.remove()));
                    // set new breakpoints
                    await Promise.all(args.breakpoints.map(async (functionBreakpoint, index) => {
                        try {
                            await connection.sendBreakpointSetCommand(new xdebug.CallBreakpoint(functionBreakpoint.name, functionBreakpoint.condition));
                            // only capture each breakpoint once
                            if (connectionIndex === 0) {
                                vscodeBreakpoints[index] = {verified: true};
                            }
                        } catch (error) {
                            // only capture each breakpoint once
                            if (connectionIndex === 0) {
                                vscodeBreakpoints[index] = {verified: false, message: error instanceof Error ? error.message : error};
                            }
                        }
                    }));
                }));
            }
            response.body = {breakpoints: vscodeBreakpoints};
        } catch (error) {
            this.sendErrorResponse(response, error);
            return;
        }
        this.sendResponse(response);
    }

    /** Executed after all breakpoints have been set by VS Code */
    protected async configurationDoneRequest(response: VSCodeDebugProtocol.ConfigurationDoneResponse, args: VSCodeDebugProtocol.ConfigurationDoneArguments) {
        let xdebugResponses: xdebug.StatusResponse[] = [];
        try {
            xdebugResponses = await Promise.all<xdebug.StatusResponse>(Array.from(this._waitingConnections).map(connection => {
                this._waitingConnections.delete(connection);
                // either tell VS Code we stopped on entry or run the script
                if (this._args.stopOnEntry) {
                    // do one step to the first statement
                    return connection.sendStepIntoCommand();
                } else {
                    return connection.sendRunCommand();
                }
            }));
        } catch (error) {
            this.sendErrorResponse(response, <Error>error);
            for (const response of xdebugResponses) {
                this._checkStatus(response);
            }
            return;
        }
        this.sendResponse(response);
        for (const response of xdebugResponses) {
            this._checkStatus(response);
        }
    }

    /** Executed after a successfull launch or attach request and after a ThreadEvent */
    protected threadsRequest(response: VSCodeDebugProtocol.ThreadsResponse): void {
        // PHP doesn't have threads, but it may have multiple requests in parallel.
        // Think about a website that makes multiple, parallel AJAX requests to your PHP backend.
        // XDebug opens a new socket connection for each of them, we tell VS Code that these are our threads.
        const connections = Array.from(this._connections.values());
        response.body = {
            threads: connections.map(connection => new vscode.Thread(connection.id, `Request ${connection.id} (${moment(connection.timeEstablished).format('LTS')})`))
        };
        this.sendResponse(response);
    }

    /** Called by VS Code after a StoppedEvent */
    protected async stackTraceRequest(response: VSCodeDebugProtocol.StackTraceResponse, args: VSCodeDebugProtocol.StackTraceArguments) {
        try {
            const connection = this._connections.get(args.threadId);
            if (!connection) {
                throw new Error('Unknown thread ID');
            }
            const {stack} = await connection.sendStackGetCommand();
            // First delete the old stack trace info ???
            // this._stackFrames.clear();
            // this._properties.clear();
            // this._contexts.clear();
            const status = this._statuses.get(connection);
            if (stack.length === 0 && status && status.exception) {
                // special case: if a fatal error occurs (for example after an uncaught exception), the stack trace is EMPTY.
                // in that case, VS Code would normally not show any information to the user at all
                // to avoid this, we create a virtual stack frame with the info from the last status response we got
                const status = this._statuses.get(connection);
                const id = this._stackFrameIdCounter++;
                const name = status.exception.name;
                let line = status.line;
                let source: vscode.Source;
                const urlObject = url.parse(status.fileUri);
                if (urlObject.protocol === 'dbgp:') {
                    const sourceReference = this._sourceIdCounter++;
                    this._sources.set(sourceReference, {connection, url: status.fileUri});
                    // for eval code, we need to include .php extension to get syntax highlighting
                    source = new vscode.Source(status.exception.name + '.php', null, sourceReference, status.exception.name);
                    // for eval code, we add a "<?php" line at the beginning to get syntax highlighting (see sourceRequest)
                    line++;
                } else {
                    // XDebug paths are URIs, VS Code file paths
                    const filePath = convertDebuggerPathToClient(urlObject, this._args.localSourceRoot, this._args.serverSourceRoot);
                    // "Name" of the source and the actual file path
                    source = new vscode.Source(path.basename(filePath), filePath);
                }
                this._errorStackFrames.set(id, status);
                response.body = {stackFrames: [new vscode.StackFrame(id, name, source, status.line, 1)]};
            } else {
                response.body = {
                    stackFrames: stack.map(stackFrame => {
                        let source: vscode.Source;
                        let line = stackFrame.line;
                        const urlObject = url.parse(stackFrame.fileUri);
                        if (urlObject.protocol === 'dbgp:') {
                            const sourceReference = this._sourceIdCounter++;
                            this._sources.set(sourceReference, {connection, url: stackFrame.fileUri});
                            // for eval code, we need to include .php extension to get syntax highlighting
                            source = new vscode.Source(stackFrame.type === 'eval' ? 'eval.php' : stackFrame.name, null, sourceReference, stackFrame.type);
                            // for eval code, we add a "<?php" line at the beginning to get syntax highlighting (see sourceRequest)
                            line++;
                        } else {
                            // XDebug paths are URIs, VS Code file paths
                            const filePath = convertDebuggerPathToClient(urlObject, this._args.localSourceRoot, this._args.serverSourceRoot);
                            // "Name" of the source and the actual file path
                            source = new vscode.Source(path.basename(filePath), filePath);
                        }
                        // a new, unique ID for scopeRequests
                        const stackFrameId = this._stackFrameIdCounter++;
                        // save the connection this stackframe belongs to and the level of the stackframe under the stacktrace id
                        this._stackFrames.set(stackFrameId, stackFrame);
                        // prepare response for VS Code (column is always 1 since XDebug doesn't tell us the column)
                        return new vscode.StackFrame(stackFrameId, stackFrame.name, source, line, 1);
                    })
                };
            }
        } catch (error) {
            this.sendErrorResponse(response, error);
            return;
        }
        this.sendResponse(response);
    }

    protected async sourceRequest(response: VSCodeDebugProtocol.SourceResponse, args: VSCodeDebugProtocol.SourceArguments) {
        try {
            const {connection, url} = this._sources.get(args.sourceReference);
            let {source} = await connection.sendSourceCommand(url);
            if (!/^\s*<\?(php|=)/.test(source)) {
                // we do this because otherwise VS Code would not show syntax highlighting for eval() code
                source = '<?php\n' + source;
            }
            response.body = {content: source, mimeType: 'application/x-php'};
        } catch (error) {
            this.sendErrorResponse(response, error);
            return;
        }
        this.sendResponse(response);
    }

    protected async scopesRequest(response: VSCodeDebugProtocol.ScopesResponse, args: VSCodeDebugProtocol.ScopesArguments) {
        try {
            let scopes: vscode.Scope[] = [];
            if (this._errorStackFrames.has(args.frameId)) {
                // VS Code is requesting the scopes for a virtual error stack frame
                const status = this._errorStackFrames.get(args.frameId);
                if (status.exception) {
                    const variableId = this._variableIdCounter++;
                    this._errorScopes.set(variableId, status);
                    scopes = [new vscode.Scope(status.exception.name.replace(/^(.*\\)+/g, ''), variableId)];
                }
            } else {
                const stackFrame = this._stackFrames.get(args.frameId);
                const contexts = await stackFrame.getContexts();
                scopes = contexts.map(context => {
                    const variableId = this._variableIdCounter++;
                    // remember that this new variable ID is assigned to a SCOPE (in XDebug "context"), not a variable (in XDebug "property"),
                    // so when VS Code does a variablesRequest with that ID we do a context_get and not a property_get
                    this._contexts.set(variableId, context);
                    // send VS Code the variable ID as identifier
                    return new vscode.Scope(context.name, variableId);
                });
                const status = this._statuses.get(stackFrame.connection);
                if (status && status.exception) {
                    const variableId = this._variableIdCounter++;
                    this._errorScopes.set(variableId, status);
                    scopes.unshift(new vscode.Scope(status.exception.name.replace(/^(.*\\)+/g, ''), variableId));
                }
            }
            response.body = {scopes};
        } catch (error) {
            this.sendErrorResponse(response, error);
            return;
        }
        this.sendResponse(response);
    }

    protected async variablesRequest(response: VSCodeDebugProtocol.VariablesResponse, args: VSCodeDebugProtocol.VariablesArguments) {
        try {
            const variablesReference = args.variablesReference;
            let variables: VSCodeDebugProtocol.Variable[];
            if (this._errorScopes.has(variablesReference)) {
                // this is a virtual error scope
                const status = this._errorScopes.get(variablesReference);
                variables = [
                    new vscode.Variable('type', status.exception.name),
                    new vscode.Variable('message', '"' + status.exception.message + '"')
                ];
                if (status.exception.code !== undefined) {
                    variables.push(new vscode.Variable('code', status.exception.code + ''));
                }
            } else {
                // it is a real scope
                let properties: xdebug.BaseProperty[];
                if (this._contexts.has(variablesReference)) {
                    // VS Code is requesting the variables for a SCOPE, so we have to do a context_get
                    const context = this._contexts.get(variablesReference);
                    properties = await context.getProperties();
                } else if (this._properties.has(variablesReference)) {
                    // VS Code is requesting the subelements for a variable, so we have to do a property_get
                    const property = this._properties.get(variablesReference);
                    properties = property.hasChildren ? await property.getChildren() : [];
                } else if (this._evalResultProperties.has(variablesReference)) {
                    // the children of properties returned from an eval command are always inlined, so we simply resolve them
                    const property = this._evalResultProperties.get(variablesReference);
                    properties = property.hasChildren ? property.children : [];
                } else {
                    throw new Error('Unknown variable reference');
                }
                variables = properties.map(property => {
                    const displayValue = formatPropertyValue(property);
                    let variablesReference: number;
                    if (property.hasChildren || property.type === 'array' || property.type === 'object') {
                        // if the property has children, we have to send a variableReference back to VS Code
                        // so it can receive the child elements in another request.
                        // for arrays and objects we do it even when it does not have children so the user can still expand/collapse the entry
                        variablesReference = this._variableIdCounter++;
                        if (property instanceof xdebug.Property) {
                            this._properties.set(variablesReference, property);
                        } else if (property instanceof xdebug.EvalResultProperty) {
                            this._evalResultProperties.set(variablesReference, property);
                        }
                    } else {
                        variablesReference = 0;
                    }
                    const variable: VSCodeDebugProtocol.Variable = {
                        name: property.name,
                        value: displayValue,
                        type: property.type,
                        variablesReference
                    };
                    return variable;
                });
            }
            response.body = {variables};
        } catch (error) {
            this.sendErrorResponse(response, error);
            return;
        }
        this.sendResponse(response);
    }

    protected async continueRequest(response: VSCodeDebugProtocol.ContinueResponse, args: VSCodeDebugProtocol.ContinueArguments) {
        let xdebugResponse: xdebug.StatusResponse;
        try {
            const connection = this._connections.get(args.threadId);
            if (!connection) {
                throw new Error('Unknown thread ID ' + args.threadId);
            }
            xdebugResponse = await connection.sendRunCommand();
        } catch (error) {
            this.sendErrorResponse(response, error);
            if (xdebugResponse) {
                this._checkStatus(xdebugResponse);
            }
            return;
        }
        this.sendResponse(response);
        this._checkStatus(xdebugResponse);
    }

    protected async nextRequest(response: VSCodeDebugProtocol.NextResponse, args: VSCodeDebugProtocol.NextArguments) {
        let xdebugResponse: xdebug.StatusResponse;
        try {
            const connection = this._connections.get(args.threadId);
            if (!connection) {
                throw new Error('Unknown thread ID ' + args.threadId);
            }
            xdebugResponse = await connection.sendStepOverCommand();
        } catch (error) {
            this.sendErrorResponse(response, error);
            if (xdebugResponse) {
                this._checkStatus(xdebugResponse);
            }
            return;
        }
        response.body = {
            allThreadsContinued: false
        };
        this.sendResponse(response);
        this._checkStatus(xdebugResponse);
    }

    protected async stepInRequest(response: VSCodeDebugProtocol.StepInResponse, args: VSCodeDebugProtocol.StepInArguments) {
        let xdebugResponse: xdebug.StatusResponse;
        try {
            const connection = this._connections.get(args.threadId);
            if (!connection) {
                throw new Error('Unknown thread ID ' + args.threadId);
            }
            xdebugResponse = await connection.sendStepIntoCommand();
        } catch (error) {
            this.sendErrorResponse(response, error);
            if (xdebugResponse) {
                this._checkStatus(xdebugResponse);
            }
            return;
        }
        this.sendResponse(response);
        this._checkStatus(xdebugResponse);
    }

    protected async stepOutRequest(response: VSCodeDebugProtocol.StepOutResponse, args: VSCodeDebugProtocol.StepOutArguments) {
        let xdebugResponse: xdebug.StatusResponse;
        try {
            const connection = this._connections.get(args.threadId);
            if (!connection) {
                throw new Error('Unknown thread ID ' + args.threadId);
            }
            xdebugResponse = await connection.sendStepOutCommand();
        } catch (error) {
            this.sendErrorResponse(response, error);
            if (xdebugResponse) {
                this._checkStatus(xdebugResponse);
            }
            return;
        }
        this.sendResponse(response);
        this._checkStatus(xdebugResponse);
    }

    protected pauseRequest(response: VSCodeDebugProtocol.PauseResponse, args: VSCodeDebugProtocol.PauseArguments) {
        this.sendErrorResponse(response, new Error('Pausing the execution is not supported by XDebug'));
    }

    protected async disconnectRequest(response: VSCodeDebugProtocol.DisconnectResponse, args: VSCodeDebugProtocol.DisconnectArguments) {
        try {
            await Promise.all(Array.from(this._connections).map(async ([id, connection]) => {
                await connection.sendStopCommand();
                await connection.close();
                this._connections.delete(id);
                this._waitingConnections.delete(connection);
            }));
            if (this._server) {
                await new Promise(resolve => this._server.close(resolve));
            }
        } catch (error) {
            this.sendErrorResponse(response, error);
            return;
        }
        this.sendResponse(response);
        this.shutdown();
    }

    protected async evaluateRequest(response: VSCodeDebugProtocol.EvaluateResponse, args: VSCodeDebugProtocol.EvaluateArguments) {
        try {
            const connection = this._stackFrames.get(args.frameId).connection;
            const {result} = await connection.sendEvalCommand(args.expression);
            if (result) {
                const displayValue = formatPropertyValue(result);
                let variablesReference: number;
                // if the property has children, generate a variable ID and save the property (including children) so VS Code can request them
                if (result.hasChildren || result.type === 'array' || result.type === 'object') {
                    variablesReference = this._variableIdCounter++;
                    this._evalResultProperties.set(variablesReference, result);
                } else {
                    variablesReference = 0;
                }
                response.body = {result: displayValue, variablesReference};
            } else {
                response.body = {result: 'no result', variablesReference: 0};
            }
            this.sendResponse(response);
        } catch (error) {
            this.sendErrorResponse(response, error);
        }
    }
}

vscode.DebugSession.run(PhpDebugSession);

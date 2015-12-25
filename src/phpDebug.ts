import {
    DebugSession,
    InitializedEvent,
    TerminatedEvent,
    StoppedEvent,
    OutputEvent,
    Thread,
    ThreadEvent,
    StackFrame,
    Scope,
    Source,
    Handles,
    Breakpoint,
    Variable
} from 'vscode-debugadapter';
import {DebugProtocol} from 'vscode-debugprotocol';
import * as net from 'net';
import * as assert from 'assert';
import {parseString} from 'xml2js';
import {XMLNode, XDebugConnection} from './xdebugConnection';
import moment = require('moment');
import * as url from 'url';
import * as path from 'path';
import * as os from 'os';
import * as iconv from 'iconv-lite';


function path2uri(str: string): string {
    var pathName = str.replace(/\\/g, '/');
    if (pathName[0] !== '/') {
        pathName = '/' + pathName;
    }
    return encodeURI('file://' + pathName);
}

function uri2path(uri: string): string {
    return url.parse(uri).pathname.substr(1);
}

/**
 * This interface should always match the schema found in the mock-debug extension manifest.
 */
export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** The port where the adapter should listen for XDebug connections (default: 9000) */
    port: number;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
}

class XDebugStackFrame {
    public connection: XDebugConnection;
    public level: number;
    constructor(connection: XDebugConnection, level: number) {
        this.connection = connection;
        this.level = level;
    }
}

class XDebugContext {
    public stackFrame: XDebugStackFrame;
    public contextId: number;
    constructor(StackFrame: XDebugStackFrame, contextId: number) {
        this.stackFrame = StackFrame;
        this.contextId = contextId;
    }
}

class XDebugProperty {
    public context: XDebugContext;
    /** This is the unique long name under which the property can be referenced INSIDE a context */
    public longName: string;
    constructor(context: XDebugContext, longName: string) {
        this.context = context;
        this.longName = longName;
    }
}

class PhpDebugSession extends DebugSession {

    private _args: LaunchRequestArguments;
    private _server: net.Server;
    /** All XDebug Connections. XDebug makes a new connection for each request to the webserver. */
    private _connections = new Map<number, XDebugConnection>();
    /** The first connection we receive, because we only have to set breakpoints once. */
    private _mainConnection: XDebugConnection = null;
    /** A map of file URIs to lines: breakpoints received from VS Code */
    private _breakpoints = new Map<string, number[]>();
    /** The activated exception breakpoint settings */
    private _exceptionBreakpoints: string[] = [];
    /** A counter for unique stackframe IDs */
    private _stackFrameIdCounter = 1;
    /** Maps a stackframe ID to its connection and the level inside the stacktrace for scope requests */
    private _stackFrames = new Map<number, XDebugStackFrame>();
    /** A counter for unique context and variable IDs (as the content of a scope is requested by a VariableRequest from VS Code) */
    private _variableIdCounter = 1;
    /** A map that maps a unique VS Code variable ID to an XDebug contextId and an XDebug stackframe */
    private _contexts = new Map<number, XDebugContext>();
    /** A map that maps a unique VS Code variable ID to an XDebug scope and an XDebug long variable name */
    private _properties = new Map<number, XDebugProperty>();

    public constructor(debuggerLinesStartAt1: boolean = true, isServer: boolean = false) {
        super(debuggerLinesStartAt1, isServer);
    }

    protected attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments) {
        this.sendErrorResponse(response, 0, 'Attach requests are not supported');
        this.shutdown();
    }

    protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
        this._args = args;
        const server = this._server = net.createServer();
        server.on('connection', socket => {
            // new XDebug connection
            const connection = new XDebugConnection(socket);
            this._connections.set(connection.id, connection);
            if (this._mainConnection) {
                // this is a new connection, for example triggered by a seperate, parallel request to the webserver.
                // We tell VS Code that this is a new thread, but do not have to set breakpoints again as they are shared automatically.
                this.sendEvent(new ThreadEvent('started', connection.id));
                connection.waitForInitPacket().then(() => this._runOrStopOnEntry(connection));
            } else {
                // this is the first connection
                this._mainConnection = connection;
                connection.waitForInitPacket()
                    // set max_depth to 1 since VS Code requests nested structures individually anyway
                    .then(() => connection.setFeature('max_depth', '1'))
                    // raise default of 32
                    .then(() => connection.setFeature('max_children', '1000'))
                    .then(() => {
                        // tell VS Code we are ready to accept breakpoints
                        // once VS Code has set all breakpoints setExceptionBreakpointsRequest will automatically call _runOrStopOnEntry with the mainConnection.
                        this.sendEvent(new InitializedEvent());
                    });
            }
        });
        server.listen(args.port);
        this.sendResponse(response);
    }

    private _runOrStopOnEntry(connection: XDebugConnection): void {
        // either tell VS Code we stopped on entry or run the script
        if (this._args.stopOnEntry) {
            this.sendEvent(new StoppedEvent('entry', connection.id));
        } else {
            connection.run().then(response => this._checkStatus(response, connection));
        }
    }

    private _checkStatus(response: XMLNode, connection: XDebugConnection): void {
        const status = response.attributes['status'];
        const command = response.attributes['command'];
        if (status === 'stopping') {
            connection.stop().then(response => this._checkStatus(response, connection));
        } else if (status === 'stopped') {
            connection.close().then(() => {
                this._connections.delete(connection.id);
                if (this._mainConnection === connection) {
                    this._mainConnection = null;
                }
                this.sendEvent(new ThreadEvent('exited', connection.id));
            });
        } else if (status === 'break') {
            // StoppedEvent reason can be 'step', 'breakpoint', 'exception' or 'pause'
            let stoppedEventReason: string;
            let exceptionText: string;
            const xdebugMessage = response.childNodes['xdebug:message'][0];
            if (xdebugMessage.attributes['exception']) {
                stoppedEventReason = 'exception';
                exceptionText = xdebugMessage.attributes['exception'] + ': ' + xdebugMessage.content; // this seems to be ignored currently by VS Code
            } else if (command === 'step_over' || command === 'step_into' || command === 'step_out') {
                stoppedEventReason = 'step';
            } else {
                stoppedEventReason = 'breakpoint';
            }
            this.sendEvent(new StoppedEvent(stoppedEventReason, connection.id, exceptionText));
        }
    }

    protected dispatchRequest(request: DebugProtocol.Request) {
        console.log(request.command + 'Request');
        super.dispatchRequest(request);
    }

    /**
     * This is called for each source file that has breakpoints with all the breakpoints in that file and whenever these change.
     */
    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {
        const file = path2uri(args.source.path);
        this._breakpoints.set(file, args.lines);
        const breakpoints = [];
        return Promise.all(args.lines.map(line =>
            this._mainConnection.setLineBreakpoint(file, line)
                .then(xdebugResponse => {
                    if (xdebugResponse.childNodes && xdebugResponse.childNodes['error']) {
                        throw new Error();
                    }
                    breakpoints.push(new Breakpoint(true, line));
                })
                .catch(error => {
                    console.error('Breakpoint could not be set', args, error);
                    breakpoints.push(new Breakpoint(false, line));
                })
        )).then(() => {
            response.body = {breakpoints};
            this.sendResponse(response);
        });
    }

    private _setBreakpoints(): Promise<void> {
        // for all connections
        return Promise.all(Array.from(this._connections.values()).map(connection => {
            return connection.listBreakpoints().then(response => {
                // first remove all breakpoints for this connection
                return Promise.all(response.childNodes['breakpoint'].map(breakpointNode => {
                    const breakpointId = parseInt(breakpointNode.attributes['id']);
                    return connection.removeBreakpoint(breakpointId)
                })).then(() => {
                    // then, for all saved files, for all lines, set a new breakpoint at that position
                    return Promise.all(Array.from(this._breakpoints).map(([file, lines]) => {
                        return Promise.all(lines.map(line => {
                            return connection.setLineBreakpoint(file, line).then(xdebugResponse => {
                                // check if it worked
                                if (xdebugResponse.childNodes && xdebugResponse.childNodes['error']) {
                                    lines.splice(lines.indexOf(line), 1);
                                }
                            });
                        }));
                    }));
                });
            });
        })).then(() => {});
    }

    /**
     * This is called once after all line breakpoints have been set and I believe whenever the breakpoints settings change
     */
    protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
        // args.filters can contain 'all' and 'uncaught', but 'uncaught' is the only setting XDebug supports
        Promise.resolve()
            .then(() => {
                if (args.filters.indexOf('uncaught') !== -1) {
                    return this._mainConnection.setExceptionBreakpoint('Warning')
                        .then(() => this._mainConnection.setExceptionBreakpoint('Exception'))
                        .then(() => this._mainConnection.setExceptionBreakpoint('Error'));
                }
            })
            .then(() => {
                this.sendResponse(response);
                this._runOrStopOnEntry(this._mainConnection);
            })
    }

    /**
     * Executed after a successfull launch or attach request (and whenever VS Code feels the need?!)
     */
    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        // PHP doesn't have threads, but it may have multiple requests in parallel.
        // Think about a website that makes multiple, parallel AJAX requests to your PHP backend.
        // XDebug opens a new socket connection for each of them, we tell VS Code that these are our threads.
        response.body = {
            threads: Array.from(this._connections.values()).map(connection => new Thread(connection.id, `Request ${connection.id} (${moment(connection.timeEstablished).format('LTS')})`))
        };
        this.sendResponse(response);
    }

    /**
     * Called by VS Code after a StoppedEvent
     */
    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
        const connection = this._connections.get(args.threadId);
        connection.getStack()
            .then(xdebugResponse => {
                // First delete the old stack trace info
                this._stackFrames.clear();
                response.body = {
                    stackFrames: xdebugResponse.childNodes['stack'].map(stackNode => {
                        // XDebug paths are URIs, VS Code file paths
                        const file = uri2path(stackNode.attributes['filename']);
                        // "Name" of the source and the actual file path
                        const source = new Source(path.basename(file), file);
                        // line number in the file
                        const line = parseInt(stackNode.attributes['lineno']);
                        // a new, unique ID for scopeRequests
                        const stackFrameId = this._stackFrameIdCounter++;
                        // the level of this stackframe inside the stacktrace
                        const level = parseInt(stackNode.attributes['level']);
                        // the name of the stackframe, like a function name or "{main}"
                        const name = stackNode.attributes['where'];
                        // save the connection this stackframe belongs to and the level of the stackframe under the stacktrace id
                        this._stackFrames.set(stackFrameId, new XDebugStackFrame(connection, level));
                        // prepare response for VS Code (column is always 1 since XDebug doesn't tell us the column)
                        return new StackFrame(stackFrameId, name, source, line, 1);
                    })
                }
                this.sendResponse(response);
            })
            .catch(error => {
                this.sendErrorResponse(response, error.code, error.message);
            });
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
        const stackFrame = this._stackFrames.get(args.frameId);
        stackFrame.connection.getContextNames(stackFrame.level)
            .then(xdebugResponse => {
                if (xdebugResponse.childNodes['error']) {
                    throw new Error(); // TODO analyze error
                }
                response.body = {
                    scopes: xdebugResponse.childNodes['context'].map(contextNode => {
                        const contextId = parseInt(contextNode.attributes['id']);
                        const contextName = contextNode.attributes['name'];
                        const variableId = this._variableIdCounter++;
                        // remember that this new variable ID is assigned to a SCOPE (in XDebug "context"), not a variable (in XDebug "property"),
                        // so when VS Code does a variablesRequest with that ID we do a context_get and not a property_get
                        this._contexts.set(variableId, new XDebugContext(stackFrame, contextId));
                        // send VS Code the variable ID as identifier
                        return new Scope(contextName, variableId);
                    })
                };
                this.sendResponse(response);
            })
            .catch(error => {
                this.sendErrorResponse(response, error.code, error.message);
            });
    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        let xdebugRequest: Promise<XMLNode>;
        let context: XDebugContext;
        if (this._contexts.has(args.variablesReference)) {
            // VS Code is requesting the variables for a SCOPE, so we have to do a context_get
            context = this._contexts.get(args.variablesReference);
            xdebugRequest = context.stackFrame.connection.getContext(context.stackFrame.level, context.contextId);
        } else if (this._properties.has(args.variablesReference)) {
            // VS Code is requesting the subelements for a variable, so we have to do a property_get
            const variable = this._properties.get(args.variablesReference);
            context = variable.context;
            xdebugRequest = context.stackFrame.connection.getProperty(context.stackFrame.level, context.contextId, variable.longName)
                .then(xdebugResponse => {
                    if (xdebugResponse.childNodes && xdebugResponse.childNodes['error']) {
                        throw new Error();
                    } else if (!xdebugResponse.childNodes || !xdebugResponse.childNodes['property'] || !xdebugResponse.childNodes['property'][0]) {
                        return {};
                    } else {
                        return xdebugResponse.childNodes['property'][0];
                    }
                })
        } else {
            console.error('Unknown variable reference: ' + args.variablesReference);
            console.error('Known variables: ' + JSON.stringify(Array.from(this._properties)));
            this.sendErrorResponse(response, 0, 'Unknown variable reference');
        }
        xdebugRequest
            .then(xdebugResponse => {
                if (!xdebugResponse.childNodes || !xdebugResponse.childNodes['property']) {
                    response.body = {variables: []};
                } else {
                    response.body = {
                        variables: xdebugResponse.childNodes['property'].map(propertyNode => {
                            const name = propertyNode.attributes['name'];
                            const type = propertyNode.attributes['type'];
                            let variableReference: number;
                            let value: string;
                            if (parseInt(propertyNode.attributes['children']) || type === 'array') {
                                // if the attribute "children" is 1, we have to send a variableReference back to VS Code
                                // so it can receive the child elements in another request.
                                variableReference = this._variableIdCounter++;
                                const longName = propertyNode.attributes['fullname'];
                                this._properties.set(variableReference, new XDebugProperty(context, longName));
                                // we show the type of the property ("array", "object") as the value
                                value = type;
                                if (type === 'array' && typeof propertyNode.attributes['numchildren'] !== undefined) {
                                    // show the length, like a var_dump would do
                                    value += '(' + propertyNode.attributes['numchildren'] + ')';
                                }
                            } else {
                                variableReference = 0;
                                if (!propertyNode.content) {
                                    if (type === 'uninitialized' || type === 'null') {
                                        value = type;
                                    } else {
                                        value = '';
                                    }
                                } else if (propertyNode.attributes['encoding'] === 'base64') {
                                    value = (new Buffer(propertyNode.content, 'base64')).toString();
                                } else {
                                    value = propertyNode.content;
                                }
                                if (type === 'string') {
                                    value = '"' + value + '"';
                                } else if (type === 'bool') {
                                    value = !!parseInt(propertyNode.content) + '';
                                }
                            }
                            return new Variable(name, value, variableReference);
                        })
                    }
                    if (parseInt(xdebugResponse.attributes['numchildren']) > parseInt(xdebugResponse.attributes['pagesize'])) {
                        // indicate that we omitted members from the list
                        response.body.variables.push(new Variable('...', '...'));
                    }
                }
                this.sendResponse(response);
            })
            .catch(error => {
                this.sendErrorResponse(response, error.code, error.message);
            })
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        const connection = this._connections.get(args.threadId);
        connection.run().then(response => this._checkStatus(response, connection));
        this.sendResponse(response);
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        const connection = this._connections.get(args.threadId);
        connection.stepOver().then(response => this._checkStatus(response, connection));
        this.sendResponse(response);
    }

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) : void {
        const connection = this._connections.get(args.threadId);
        connection.stepInto().then(response => this._checkStatus(response, connection));
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments) : void {
        const connection = this._connections.get(args.threadId);
        connection.stepOut().then(response => this._checkStatus(response, connection));
		this.sendResponse(response);
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments) : void {
		this.sendErrorResponse(response, 0, 'Pausing the execution is not supported by XDebug');
	}

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        Promise.all(Array.from(this._connections).map(([id, connection]) =>
            connection.stop()
                .then(response => connection.close())
                .then(() => {
                    this._connections.delete(id);
                    if (this._mainConnection === connection) {
                        this._mainConnection = null;
                    }
                })
        )).then(() => {
            this._server.close(() => {
                this.shutdown();
                this.sendResponse(response);
            })
        });
	}

    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
        this._stackFrames.get(args.frameId).connection.eval(args.expression).then(xdebugResponse => {
            if (xdebugResponse.childNodes['error']) {
                this.sendErrorResponse(response, 0, JSON.stringify(xdebugResponse.childNodes['error']));
            } else if (xdebugResponse.childNodes['property']) {
                response.body = {
                    result: xdebugResponse.childNodes['property'][0].content,
                    variablesReference: 0
                };
            }
            this.sendResponse(response);
        })
    }
}

DebugSession.run(PhpDebugSession);

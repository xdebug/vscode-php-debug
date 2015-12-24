/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

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
export interface LaunchRequestArguments {
    /** The port where the adapter should listen for XDebug connections (default: 9000) */
    port: number;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
    /**
     * The types of Exceptions the adapter should break on.
     * If true, will default to ['Throwable'] for PHP7 and ['Exception'] for PHP <7
     */
    breakOnExceptions?: boolean|string[];
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
    private _mainConnection: XDebugConnection;
    /** A counter for unique stackframe IDs */
    private _stackFrameIdCounter = 1;
    /** Maps a stackframe ID to its connection and the level inside the stacktrace for scope requests */
    private _stackFrames = new Map<number, XDebugStackFrame>();
    /** A counter for unique scope and variable IDs (as the content of a scope is requestet by a VariableRequest by VS Code) */
    private _variableIdCounter = 1;
    /** A map that maps a unique VS Code variable ID to an XDebug contextId and an XDebug stackframe */
    private _contexts = new Map<number, XDebugContext>();
    /** A map that maps a unique VS Code variable ID to an XDebug scope and an XDebug long variable name */
    private _properties = new Map<number, XDebugProperty>();

    public constructor(debuggerLinesStartAt1: boolean = true, isServer: boolean = false) {
        super(debuggerLinesStartAt1, isServer);
    }

    protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
        this._args = args;
        const server = this._server = net.createServer();
        server.on('connection', socket => {
            // new XDebug connection
            const connection = new XDebugConnection(socket);
            this._connections.set(connection.id, connection);
            if (this._connections.size > 1) {
                // this is a new connection, for example triggered by a seperate, parallel request to the webserver.
                // We tell VS Code that this is a new thread, but do not have to set breakpoints again as they are shared automatically.
                this.sendEvent(new ThreadEvent('started', connection.id));
                connection.waitForInitPacket().then(() => this._runOrStopOnEntry(connection));
            } else {
                // this is the first connection. We wait for the init event and then tell VS Code that we're ready to receive breakpoints.
                this._mainConnection = connection;
                connection.waitForInitPacket().then(() => {
                    this.sendEvent(new InitializedEvent());
                    // VS Code first calls setBreakPointsRequest multiple times and then setExceptionBreakPointsRequest ONCE.
                    // thats our sign that we can run the script
                    this.on('exception_breakpoints_set', () => {
                        this._runOrStopOnEntry(connection);
                    });
                });
            }
        });
        server.listen(args.port);
        this.sendResponse(response);
    }

    private _runOrStopOnEntry(connection: XDebugConnection) {
        // either tell VS Code we stopped on entry or run the script
        if (this._args.stopOnEntry) {
            this.sendEvent(new StoppedEvent('entry', connection.id));
        } else {
            connection.run().then(response => this._checkStatus(response, connection));
        }
    }

    private _checkStatus(response: XMLNode, connection: XDebugConnection): void {
        const status = response.attributes['status'];
        const reason = response.attributes['reason'];
        if (status === 'stopping' || status === 'stopped') {
            this.sendEvent(new TerminatedEvent());
        } else if (status === 'break') {
            // StoppedEvent reason can be 'step', 'breakpoint', 'exception', 'pause'
            let stoppedEventReason;
            if (reason === 'exception' || reason === 'error') {
                stoppedEventReason = 'exception';
            } else if (reason === 'ok') {
                // TODO: do we have to check if there is a breakpoint on that line?
                stoppedEventReason = 'breakpoint';
            }
            this.sendEvent(new StoppedEvent('breakpoint', connection.id));
        }
    }

    /**
     * This is called for each source file that has breakpoints with all the breakpoints in that file and whenever these change.
     */
    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
        console.log('setBreakPointsRequest');
        const file = path2uri(args.source.path);
        const breakpoints = [];
        // TODO: clear breakpoints
        Promise.all(args.lines.map(line =>
            this._mainConnection.setLineBreakpoint(file, line)
                .then(xdebugReponse => {
                    if (xdebugReponse.childNodes && xdebugReponse.childNodes['error']) {
                        throw new Error();
                    }
                    breakpoints.push(new Breakpoint(true, line));
                })
                .catch(error => {
                    console.error('Breakpoint could not be set', args, error);
                    breakpoints.push(new Breakpoint(false, line));
                })
        ))
            .then(() => {
                response.body = {breakpoints};
                this.sendResponse(response);
                this.emit('breakpoints_set');
            });
    }

    /**
     * This is called ONCE after all line breakpoints have been set and I believe whenever the breakpoints settings change
     */
    protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
        console.log('setExceptionBreakPointsRequest');
        // it appears to me that breaking on caught or uncaught exception is not set with a dbgp command,
        // but through a php.ini setting. Maybe we can call eval() with ini_set()?
        // Does remote_mode have to be set to jit?
        // Can we just set an exception breakpoint for the "Exception" class (or "Throwable" in PHP7), as all Exceptions inherit from it? -> feature_get language_version
        // maybe add a setting to launch.json?
        this.sendResponse(response);
        this.emit('exception_breakpoints_set');
    }

    /**
     * Executed after a successfull launch or attach request (and whenever VS Code feels the need?!)
     */
    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        console.log('threadsRequest');
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
        console.log('stackTraceRequest');
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
        console.log('scopesRequest');
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
        console.log('variablesRequest');
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
                            let variableReference: number;
                            let value: string;
                            if (parseInt(propertyNode.attributes['children']) || propertyNode.attributes['type'] === 'array') {
                                // if the attribute "children" is 1, we have to send a variableReference back to VS Code
                                // so it can receive the child elements in another request.
                                variableReference = this._variableIdCounter++;
                                const longName = propertyNode.attributes['fullname'];
                                this._properties.set(variableReference, new XDebugProperty(context, longName));
                                // we show the type of the property ("array", "object") as the value
                                value = propertyNode.attributes['type'];
                            } else {
                                variableReference = 0;
                                if (propertyNode.attributes['encoding'] === 'base64') {
                                    value = (new Buffer(propertyNode.content, 'base64')).toString();
                                } else {
                                    value = propertyNode.content;
                                }
                                if (propertyNode.attributes['type'] === 'string') {
                                    value = '"' + value + '"';
                                }
                            }
                            return new Variable(name, value, variableReference);
                        })
                    }
                    this.sendResponse(response);
                }
            })
            .catch(error => {
                this.sendErrorResponse(response, error.code, error.message);
            })
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        console.log('continueRequest');
        const connection = this._connections.get(args.threadId);
        connection.run().then(response => this._checkStatus(response, connection));
        this.sendResponse(response);
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        console.log('nextRequest');
        const connection = this._connections.get(args.threadId);
        connection.stepOver().then(response => this._checkStatus(response, connection));
        this.sendResponse(response);
    }

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) : void {
        console.log('stepInRequest');
        const connection = this._connections.get(args.threadId);
        connection.stepInto().then(response => this._checkStatus(response, connection));
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments) : void {
        console.log('stepOutRequest');
        const connection = this._connections.get(args.threadId);
        connection.stepOut().then(response => this._checkStatus(response, connection));
		this.sendResponse(response);
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments) : void {
        console.log('pauseRequest');
		this.sendErrorResponse(response, 0, 'Pausing the execution is not supported by XDebug');
	}

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        console.log('disconnectRequest');
        Promise.all(Array.from(this._connections).map(([id, connection]) =>
            connection.stop()
                .then(() => {
                    this._connections.delete(id)
                })
        )).then(() => {
            this._server.close(() => {
                this.shutdown();
                this.sendResponse(response);
            })
        });
	}

    //protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
    //    console.log('evaluateRequest');
    //    response.body = {
    //        result: `evaluate(${args.expression})`,
    //        variablesReference: 0
    //    };
    //    this.sendResponse(response);
    //}
}

DebugSession.run(PhpDebugSession);

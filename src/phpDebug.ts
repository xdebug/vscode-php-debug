import * as vscode from 'vscode-debugadapter';
import {DebugProtocol as VSCodeDebugProtocol} from 'vscode-debugprotocol';
import * as net from 'net';
import * as xdebug from './xdebugConnection';
import moment = require('moment');
import * as url from 'url';
import * as path from 'path';
import * as util from 'util';

/** PHP expression that is executed with an eval command if breaking on exceptions is enabled */
const SET_EXCEPTION_HANDLER_PHP = `
    set_exception_handler("xdebug_break");
    set_error_handler("xdebug_break");
`;

/** converts a file path to file:// URI  */
function path2uri(str: string): string {
    var pathName = str.replace(/\\/g, '/');
    if (pathName[0] !== '/') {
        pathName = '/' + pathName;
    }
    return encodeURI('file://' + pathName);
}

/** converts a file:// URI to a local file path */
function uri2path(uri: string): string {
    return url.parse(uri).pathname.substr(1);
}

/**
 * This interface should always match the schema found in the mock-debug extension manifest.
 */
interface LaunchRequestArguments extends VSCodeDebugProtocol.LaunchRequestArguments {
    /** The port where the adapter should listen for XDebug connections (default: 9000) */
    port: number;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
}

class PhpDebugSession extends vscode.DebugSession {

    /** The arguments that were given to launchRequest */
    private _args: LaunchRequestArguments;
    /** The TCP server that listens for XDebug connections */
    private _server: net.Server;
    /** All XDebug Connections. XDebug makes a new connection for each request to the webserver. */
    private _connections = new Map<number, xdebug.Connection>();
    /** The first connection we receive */
    private _mainConnection: xdebug.Connection = null;
    /** Gets set to true after _runOrStopOnEntry is called the first time */
    private _running = false;
    /** A map of file URIs to lines: breakpoints received from VS Code */
    private _breakpoints = new Map<string, number[]>();
    /** Gets set after a setExceptionBreakpointsRequest */
    private _breakOnExceptions: boolean;
    /** A counter for unique stackframe IDs */
    private _stackFrameIdCounter = 1;
    /** Maps a stackframe ID to its connection and the level inside the stacktrace for scope requests */
    private _stackFrames = new Map<number, xdebug.StackFrame>();
    /** A counter for unique context and variable IDs (as the content of a scope is requested by a VariableRequest from VS Code) */
    private _variableIdCounter = 1;
    /** A map that maps a unique VS Code variable ID to an XDebug contextId and an XDebug stackframe */
    private _contexts = new Map<number, xdebug.Context>();
    /** A map that maps a unique VS Code variable ID to an XDebug scope and an XDebug long variable name */
    private _properties = new Map<number, xdebug.Property>();
    /** A map from unique VS Code variable IDs to XDebug eval result properties, because property children returned from eval commands are always inlined */
    private _evalResultProperties = new Map<number, xdebug.EvalResultProperty>();

    public constructor(debuggerLinesStartAt1: boolean = true, isServer: boolean = false) {
        super(debuggerLinesStartAt1, isServer);
    }

    protected attachRequest(response: VSCodeDebugProtocol.AttachResponse, args: VSCodeDebugProtocol.AttachRequestArguments) {
        this.sendErrorResponse(response, 0, 'Attach requests are not supported');
        this.shutdown();
    }

    protected launchRequest(response: VSCodeDebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
        this._args = args;
        const server = this._server = net.createServer();
        server.on('connection', (socket: net.Socket) => {
            // new XDebug connection
            const connection = new xdebug.Connection(socket);
            this._connections.set(connection.id, connection);
            if (this._running) {
                // this is a new connection, for example triggered by a seperate, parallel request to the webserver.
                connection.waitForInitPacket()
                    // tell VS Code that this is a new thread
                    .then(() => {
                        this.sendEvent(new vscode.ThreadEvent('started', connection.id));
                    })
                    // set max_depth to 1 since VS Code requests nested structures individually anyway
                    .then(() => connection.sendFeatureSetCommand('max_depth', '1'))
                    // raise default of 32
                    .then(() => connection.sendFeatureSetCommand('max_children', '9999'))
                    // restore all breakpoints for the new connection
                    .then(() => Promise.all(Array.from(this._breakpoints).map(([file, lines]) =>
                        Promise.all(lines.map(line =>
                            connection.sendBreakpointSetCommand({type: 'line', file, line})
                        ))
                    )))
                    // restore exception breakpoint settings for the new connection
                    .then(() => {
                        if (this._breakOnExceptions) {
                            return connection.sendEvalCommand(SET_EXCEPTION_HANDLER_PHP);
                        }
                    })
                    // run the script or stop on entry
                    .then(() => this._runOrStopOnEntry(connection))
                    .catch(error => {
                        console.error('error: ', error);
                    });
            } else {
                // this is the first connection
                this._mainConnection = connection;
                connection.waitForInitPacket()
                    // set max_depth to 1 since VS Code requests nested structures individually anyway
                    .then(initPacket => {
                        return connection.sendFeatureSetCommand('max_depth', '1');
                    })
                    // raise default of 32
                    .then(response => {
                        return connection.sendFeatureSetCommand('max_children', '9999')
                    })
                    .then(response => {
                        // tell VS Code we are ready to accept breakpoints
                        // once VS Code has set all breakpoints setExceptionBreakpointsRequest will automatically call _runOrStopOnEntry with the mainConnection.
                        this.sendEvent(new vscode.InitializedEvent());
                    })
                    .catch(error => {
                        console.error('error: ', error);
                    });
            }
        });
        server.listen(args.port);
        this.sendResponse(response);
    }

    /** is called after all breakpoints etc. are initialized and either runs the script or notifies VS Code that we stopped on entry, depending on launch settings */
    private _runOrStopOnEntry(connection: xdebug.Connection): void {
        // either tell VS Code we stopped on entry or run the script
        if (this._args.stopOnEntry) {
            this.sendEvent(new vscode.StoppedEvent('entry', connection.id));
        } else {
            connection.sendRunCommand().then(response => this._checkStatus(response));
        }
    }

    /** Checks the status of a StatusResponse and notifies VS Code accordingly */
    private _checkStatus(response: xdebug.StatusResponse): void {
        const connection = response.connection;
        if (response.status === 'stopping') {
            connection.sendStopCommand().then(response => this._checkStatus(response));
        } else if (response.status === 'stopped') {
            connection.close().then(() => {
                this._connections.delete(connection.id);
                if (this._mainConnection === connection) {
                    this._mainConnection = null;
                }
                this.sendEvent(new vscode.ThreadEvent('exited', connection.id));
            });
        } else if (response.status === 'break') {
            // StoppedEvent reason can be 'step', 'breakpoint', 'exception' or 'pause'
            let stoppedEventReason: string;
            let exceptionText: string;
            if (response.exception) {
                stoppedEventReason = 'exception';
                exceptionText = response.exception.name + ': ' + response.exception.message; // this seems to be ignored currently by VS Code
            } else if (response.command.indexOf('step') === 0) {
                stoppedEventReason = 'step';
            } else {
                stoppedEventReason = 'breakpoint';
            }
            this.sendEvent(new vscode.StoppedEvent(stoppedEventReason, connection.id, exceptionText));
        }
    }

    /** Logs all requests before dispatching */
    protected dispatchRequest(request: VSCodeDebugProtocol.Request) {
        console.log(`\n\n-> ${request.command}Request`);
        console.log(util.inspect(request));
        super.dispatchRequest(request);
    }

    public sendEvent(event: VSCodeDebugProtocol.Event): void {
		console.log(`\n\n<- ${event.event}Event`)
        console.log(util.inspect(event));
        super.sendEvent(event);
	}

    public sendResponse(response: VSCodeDebugProtocol.Response) {
        console[response.success ? 'log' : 'error'](`\n\n<- ${response.command}Response`)
        console[response.success ? 'log' : 'error'](util.inspect(response));
        super.sendResponse(response);
    }

    /** This is called for each source file that has breakpoints with all the breakpoints in that file and whenever these change. */
    protected setBreakPointsRequest(response: VSCodeDebugProtocol.SetBreakpointsResponse, args: VSCodeDebugProtocol.SetBreakpointsArguments) {
        const file = path2uri(args.source.path);
        this._breakpoints.set(file, args.lines);
        const breakpoints: vscode.Breakpoint[] = [];
        const connections = Array.from(this._connections.values());
        return Promise.all(connections.map(connection =>
            Promise.all(args.lines.map(line =>
                connection.sendBreakpointSetCommand({type: 'line', file, line})
                    .then(xdebugResponse => {
                        // only capture each breakpoint once (for the main connection)
                        if (connection === this._mainConnection) {
                            breakpoints.push(new vscode.Breakpoint(true, line));
                        }
                    })
                    .catch(error => {
                        // only capture each breakpoint once (for the main connection)
                        if (connection === this._mainConnection) {
                            console.error('breakpoint could not be set: ', error);
                            breakpoints.push(new vscode.Breakpoint(false, line));
                        }
                    })
            ))
        )).then(() => {
            response.body = {breakpoints};
            this.sendResponse(response);
        }).catch(error => {
            this.sendErrorResponse(response, error.code, error.message);
        });
    }

    /** This is called once after all line breakpoints have been set and whenever the breakpoints settings change */
    protected setExceptionBreakPointsRequest(response: VSCodeDebugProtocol.SetExceptionBreakpointsResponse, args: VSCodeDebugProtocol.SetExceptionBreakpointsArguments): void {
        // args.filters can contain 'all' and 'uncaught', but 'uncaught' is the only setting XDebug supports
        this._breakOnExceptions = args.filters.indexOf('uncaught') !== -1;
        Promise.resolve()
            .then(() => {
                if (this._breakOnExceptions) {
                    // tell PHP to break on uncaught exceptions and errors
                    const connections = Array.from(this._connections.values());
                    return Promise.all(connections.map(connection => connection.sendEvalCommand(SET_EXCEPTION_HANDLER_PHP)));
                }
            })
            .then(() => {
                this.sendResponse(response);
                // if this is the first time this is called and the main connection is not yet running, trigger a run because now everything is set up
                if (!this._running) {
                    this._runOrStopOnEntry(this._mainConnection);
                    this._running = true;
                }
            })
            .catch(error => {
                this.sendErrorResponse(response, error.code, error.message);
            })
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
    protected stackTraceRequest(response: VSCodeDebugProtocol.StackTraceResponse, args: VSCodeDebugProtocol.StackTraceArguments): void {
        const connection = this._connections.get(args.threadId);
        connection.sendStackGetCommand()
            .then(xdebugResponse => {
                // First delete the old stack trace info ???
                // this._stackFrames.clear();
                // this._properties.clear();
                // this._contexts.clear();
                response.body = {
                    stackFrames: xdebugResponse.stack.map(stackFrame => {
                        // XDebug paths are URIs, VS Code file paths
                        const filePath = uri2path(stackFrame.fileUri);
                        // "Name" of the source and the actual file path
                        const source = new vscode.Source(path.basename(filePath), filePath);
                        // a new, unique ID for scopeRequests
                        const stackFrameId = this._stackFrameIdCounter++;
                        // save the connection this stackframe belongs to and the level of the stackframe under the stacktrace id
                        this._stackFrames.set(stackFrameId, stackFrame);
                        // prepare response for VS Code (column is always 1 since XDebug doesn't tell us the column)
                        return new vscode.StackFrame(stackFrameId, stackFrame.name, source, stackFrame.line, 1);
                    })
                }
                this.sendResponse(response);
            })
            .catch(error => {
                this.sendErrorResponse(response, error.code, error.message);
            });
    }

    protected scopesRequest(response: VSCodeDebugProtocol.ScopesResponse, args: VSCodeDebugProtocol.ScopesArguments): void {
        const stackFrame = this._stackFrames.get(args.frameId);
        stackFrame.getContexts()
            .then(contexts => {
                response.body = {
                    scopes: contexts.map(context => {
                        const variableId = this._variableIdCounter++;
                        // remember that this new variable ID is assigned to a SCOPE (in XDebug "context"), not a variable (in XDebug "property"),
                        // so when VS Code does a variablesRequest with that ID we do a context_get and not a property_get
                        this._contexts.set(variableId, context);
                        // send VS Code the variable ID as identifier
                        return new vscode.Scope(context.name, variableId);
                    })
                };
                this.sendResponse(response);
            })
            .catch(error => {
                this.sendErrorResponse(response, error.code, error.message);
            });
    }

    protected variablesRequest(response: VSCodeDebugProtocol.VariablesResponse, args: VSCodeDebugProtocol.VariablesArguments): void {
        const variablesReference = args.variablesReference
        let propertiesPromise: Promise<xdebug.BaseProperty[]>;
        if (this._contexts.has(variablesReference)) {
            // VS Code is requesting the variables for a SCOPE, so we have to do a context_get
            const context = this._contexts.get(variablesReference);
            propertiesPromise = context.getProperties();
        } else if (this._properties.has(variablesReference)) {
            // VS Code is requesting the subelements for a variable, so we have to do a property_get
            const property = this._properties.get(variablesReference);
            propertiesPromise = property.getChildren();
        } else if (this._evalResultProperties.has(variablesReference)) {
            // the children of properties returned from an eval command are always inlined, so we simply resolve them
            const property = this._evalResultProperties.get(variablesReference);
            propertiesPromise = Promise.resolve(property.children);
        } else {
            console.error('Unknown variable reference: ' + variablesReference);
            console.error('Known variables: ' + JSON.stringify(Array.from(this._properties)));
            this.sendErrorResponse(response, 0, 'Unknown variable reference');
            return;
        }
        propertiesPromise
            .then(properties => {
                response.body = {
                    variables: properties.map(property => {
                        let variablesReference: number;
                        let displayValue: string;
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
                            // we show the type of the property ("array", "object") as the value
                            displayValue = property.type;
                            if (property.type === 'array') {
                                // show the length, like a var_dump would do
                                displayValue += '(' + property.numberOfChildren + ')';
                            }
                        } else {
                            variablesReference = 0;
                            if (property.value) {
                                displayValue = property.value;
                            } else if (property.type === 'uninitialized' || property.type === 'null') {
                                displayValue = property.type;
                            } else {
                                displayValue = '';
                            }
                            if (property.type === 'string') {
                                displayValue = '"' + displayValue + '"';
                            } else if (property.type === 'bool') {
                                displayValue = !!parseInt(displayValue) + '';
                            }
                        }
                        return new vscode.Variable(property.name, displayValue, variablesReference);
                    })
                }
                this.sendResponse(response);
            })
            .catch(error => {
                console.error(util.inspect(error));
                this.sendErrorResponse(response, error.code, error.message);
            })
    }

    protected continueRequest(response: VSCodeDebugProtocol.ContinueResponse, args: VSCodeDebugProtocol.ContinueArguments): void {
        const connection = this._connections.get(args.threadId);
        connection.sendRunCommand()
            .then(response => this._checkStatus(response))
            .catch(error => this.sendErrorResponse(response, error.code, error.message));
        this.sendResponse(response);
    }

    protected nextRequest(response: VSCodeDebugProtocol.NextResponse, args: VSCodeDebugProtocol.NextArguments): void {
        const connection = this._connections.get(args.threadId);
        connection.sendStepOverCommand()
            .then(response => this._checkStatus(response))
            .catch(error => this.sendErrorResponse(response, error.code, error.message));
        this.sendResponse(response);
    }

	protected stepInRequest(response: VSCodeDebugProtocol.StepInResponse, args: VSCodeDebugProtocol.StepInArguments) : void {
        const connection = this._connections.get(args.threadId);
        connection.sendStepIntoCommand()
            .then(response => this._checkStatus(response))
            .catch(error => this.sendErrorResponse(response, error.code, error.message));
		this.sendResponse(response);
	}

	protected stepOutRequest(response: VSCodeDebugProtocol.StepOutResponse, args: VSCodeDebugProtocol.StepOutArguments) : void {
        const connection = this._connections.get(args.threadId);
        connection.sendStepOutCommand()
            .then(response => this._checkStatus(response))
            .catch(error => this.sendErrorResponse(response, error.code, error.message));
		this.sendResponse(response);
	}

	protected pauseRequest(response: VSCodeDebugProtocol.PauseResponse, args: VSCodeDebugProtocol.PauseArguments) : void {
		this.sendErrorResponse(response, 0, 'Pausing the execution is not supported by XDebug');
	}

    protected disconnectRequest(response: VSCodeDebugProtocol.DisconnectResponse, args: VSCodeDebugProtocol.DisconnectArguments): void {
        Promise.all(Array.from(this._connections).map(([id, connection]) =>
            connection.sendStopCommand()
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
        }).catch(error => {
            this.sendErrorResponse(response, error.code, error.message)
        });
	}

    protected evaluateRequest(response: VSCodeDebugProtocol.EvaluateResponse, args: VSCodeDebugProtocol.EvaluateArguments): void {
        this._stackFrames.get(args.frameId).connection.sendEvalCommand(args.expression)
            .then(xdebugResponse => {
                const value = xdebugResponse.result.value;
                let variablesReference: number;
                // if the property has children, generate a variable ID and save the property (including children) so VS Code can request them
                if (xdebugResponse.result.hasChildren) {
                    variablesReference = this._variableIdCounter++;
                    this._evalResultProperties.set(variablesReference, xdebugResponse.result);
                } else {
                    variablesReference = 0;
                }
                response.body = {result: value, variablesReference};
                this.sendResponse(response);
            })
            .catch(error => {
                this.sendErrorResponse(response, error.code, error.message)
            });
    }
}

vscode.DebugSession.run(PhpDebugSession);

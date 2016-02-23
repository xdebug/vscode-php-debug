
import * as net from 'net';
import {Thread} from 'vscode-debugadapter';
import * as iconv from 'iconv-lite';
import {DbgpConnection} from './dbgp';

/** The encoding all XDebug messages are encoded with */
const ENCODING = 'iso-8859-1';

/** The first packet we receive from XDebug. Returned by waitForInitPacket() */
export class InitPacket {
    /** The file that was requested as a file:// URI */
    fileUri: string;
    /** GDGP version (1.0) */
    protocolVersion: string;
    /** language being debugged (PHP) */
    language: string;
    /** an IDE key, by default the PC name */
    ideKey: string;
    /** a reference to the connection this packet was received from */
    connection: Connection;
    /**
     * @param  {XMLDocument} document - An XML document to read from
     * @param  {Connection} connection
     */
    constructor(document: XMLDocument, connection: Connection) {
        const documentElement = document.documentElement;
        this.fileUri = documentElement.getAttribute('fileuri');
        this.language = documentElement.getAttribute('language');
        this.protocolVersion = documentElement.getAttribute('protocol_version');
        this.ideKey = documentElement.getAttribute('idekey');
        this.connection = connection;
    }
}

/** Error class for errors returned from XDebug */
export class XDebugError extends Error {
    code: number;
    constructor(message: string, code: number) {
        super(message);
        this.code = code;
        this.name = 'XDebugError';
    }
}

/** The base class for all XDebug responses to commands executed on a connection */
export class Response {
    /** A unique transaction ID that matches the one in the request */
    transactionId: number;
    /** The command that this is an answer for */
    command: string;
    /** The connection this response was received from */
    connection: Connection;
    /**
     * contructs a new Response object from an XML document.
     * If there is an error child node, an exception is thrown with the appropiate code and message.
     * @param  {XMLDocument} document - An XML document to read from
     * @param  {Connection} connection
     */
    constructor(document: XMLDocument, connection: Connection) {
        const documentElement = document.documentElement;
        if (documentElement.hasChildNodes() && documentElement.firstChild.nodeName === 'error') {
            const errorNode = <Element>documentElement.firstChild;
            const code = parseInt(errorNode.getAttribute('code'));
            const message = errorNode.textContent;
            throw new XDebugError(message, code);
        }
        this.transactionId = parseInt(documentElement.getAttribute('transaction_id'));
        this.command = documentElement.getAttribute('command');
        this.connection = connection;
    }
}

/** A response to the status command */
export class StatusResponse extends Response {
    /** The current status. Can be 'break', ... */
    status: string;
    /** The reason for being in this status, can be 'ok', ... */
    reason: string;
    /** Contains the file URI if the status is 'break' */
    fileUri: string;
    /** Contains the line number if the status is 'break' */
    line: number;
    /** Contains info about the exception if the reason for breaking was an exception */
    exception: {
        name: string;
        message: string;
    };
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection);
        const documentElement = document.documentElement;
        this.status = documentElement.getAttribute('status');
        this.reason = documentElement.getAttribute('reason');
        if (documentElement.hasChildNodes()) {
            const messageNode = <Element>documentElement.firstChild;
            if (messageNode.hasAttribute('exception')) {
                this.exception = {
                    name: messageNode.getAttribute('exception'),
                    message: messageNode.textContent
                };
            }
            if (messageNode.hasAttribute('filename')) {
                this.fileUri = messageNode.getAttribute('filename');
            }
            if (messageNode.hasAttribute('lineno')) {
                this.line = parseInt(messageNode.getAttribute('lineno'));
            }
        }
    }
}

/** Abstract base class for all breakpoints */
export abstract class Breakpoint {
    /** Unique ID which is used for modifying the breakpoint (only when received through breakpoint_list) */
    id: number;
    /** The type of the breakpoint: line, call, return, exception, conditional or watch */
    type: string;
    /** State of the breakpoint: enabled, disabled */
    state: string;
    /** The connection this breakpoint is set on */
    connection: Connection;
    /** dynamically detects the type of breakpoint and returns the appropiate object */
    public static fromXml(breakpointNode: Element, connection: Connection): Breakpoint {
        switch (breakpointNode.getAttribute('type')) {
            case 'exception': return new ExceptionBreakpoint(breakpointNode, connection);
            case 'line': return new LineBreakpoint(breakpointNode, connection);
            case 'conditional': return new ConditionalBreakpoint(breakpointNode, connection);
        }
    }
    /** Constructs a breakpoint object from an XML node from a XDebug response */
    constructor(breakpointNode: Element, connection: Connection);
    /** To create a new breakpoint in derived classes */
    constructor(type: string);
    constructor() {
        if (typeof arguments[0] === 'object') {
            // from XML
            const breakpointNode: Element = arguments[0];
            this.connection = arguments[1];
            this.type = breakpointNode.getAttribute('type');
            this.id = parseInt(breakpointNode.getAttribute('id'));
            this.state = breakpointNode.getAttribute('state');
        } else {
            this.type = arguments[0];
        }
    }
    /** Removes the breakpoint by sending a breakpoint_remove command */
    public remove() {
        return this.connection.sendBreakpointRemoveCommand(this);
    }
}

/** class for line breakpoints. Returned from a breakpoint_list or passed to sendBreakpointSetCommand */
export class LineBreakpoint extends Breakpoint {
    /** File URI of the file in which to break */
    fileUri: string;
    /** Line to break on */
    line: number;
    /** constructs a line breakpoint from an XML node */
    constructor(breakpointNode: Element, connection: Connection);
    /** contructs a line breakpoint for passing to sendSetBreakpointCommand */
    constructor(fileUri: string, line: number);
    constructor() {
        if (typeof arguments[0] === 'object') {
            const breakpointNode: Element = arguments[0];
            const connection: Connection = arguments[1];
            super(breakpointNode, connection);
            this.line = parseInt(breakpointNode.getAttribute('line'));
        } else {
            // construct from arguments
            this.fileUri = arguments[0];
            this.line = arguments[1];
            super('line');
        }
    }
}

/** class for exception breakpoints. Returned from a breakpoint_list or passed to sendBreakpointSetCommand */
export class ExceptionBreakpoint extends Breakpoint {
    /** The Exception name to break on. Can also contain wildcards. */
    exception: string;
    /** Constructs a breakpoint object from an XML node from a XDebug response */
    constructor(breakpointNode: Element, connection: Connection);
    /** Constructs a breakpoint for passing it to sendSetBreakpointCommand */
    constructor(exception: string);
    constructor() {
        if (typeof arguments[0] === 'object') {
            // from XML
            const breakpointNode: Element = arguments[0];
            const connection: Connection = arguments[1];
            super(breakpointNode, connection);
            this.exception = breakpointNode.getAttribute('exception');
        } else {
            // from arguments
            super('exception');
            this.exception = arguments[0];
        }
    }
}

/** class for conditional breakpoints. Returned from a breakpoint_list or passed to sendBreakpointSetCommand */
export class ConditionalBreakpoint extends Breakpoint {
    /** File URI */
    fileUri: string;
    /** Line (optional)*/
    line: number;
    /** The PHP expression under which to break on */
    expression: string;
    /** Constructs a breakpoint object from an XML node from a XDebug response */
    constructor(breakpointNode: Element, connection: Connection);
    /** Contructs a breakpoint object for passing to sendSetBreakpointCommand */
    constructor(expression: string, fileUri: string, line?: number);
    constructor() {
        if (typeof arguments[0] === 'object') {
            // from XML
            const breakpointNode: Element = arguments[0];
            const connection: Connection = arguments[1];
            super(breakpointNode, connection);
            this.expression = breakpointNode.getAttribute('expression'); // Base64 encoded?
        } else {
            // from arguments
            super('conditional');
            this.expression = arguments[0];
            this.fileUri = arguments[1];
            this.line = arguments[2];
        }
    }
}

/** Response to a breakpoint_set command */
export class BreakpointSetResponse extends Response {
    breakpointId: number;
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection);
        this.breakpointId = parseInt(document.documentElement.getAttribute('id'));
    }
}

/** The response to a breakpoint_list command */
export class BreakpointListResponse extends Response {
    /** The currently set breakpoints for this connection */
    breakpoints: Breakpoint[];
    /**
     * @param  {XMLDocument} document
     * @param  {Connection} connection
     */
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection);
        this.breakpoints = Array.from(document.documentElement.childNodes).map((breakpointNode: Element) => Breakpoint.fromXml(breakpointNode, connection));
    }
}

/** One stackframe inside a stacktrace retrieved through stack_get */
export class StackFrame {
    /** The UI-friendly name of this stack frame, like a function name or "{main}" */
    name: string;
    /** The type of stack frame. Valid values are "file" and "eval" */
    type: string;
    /** The file URI where the stackframe was entered */
    fileUri: string;
    /** The line number inside file where the stackframe was entered */
    line: number;
    /** The level (index) inside the stack trace at which the stack frame receides */
    level: number;
    /** The connection this stackframe belongs to */
    connection: Connection;
    /**
     * @param  {Element} stackFrameNode
     * @param  {Connection} connection
     */
    constructor(stackFrameNode: Element, connection: Connection) {
        this.name = stackFrameNode.getAttribute('where');
        this.fileUri = stackFrameNode.getAttribute('filename');
        this.type = stackFrameNode.getAttribute('type');
        this.line = parseInt(stackFrameNode.getAttribute('lineno'));
        this.level = parseInt(stackFrameNode.getAttribute('level'));
        this.connection = connection;
    }
    /** Returns the available contexts (scopes, such as "Local" and "Superglobals") by doing a context_names command */
    public getContexts(): Promise<Context[]> {
        return this.connection.sendContextNamesCommand(this).then(response => response.contexts);
    }
}

/** The response to a stack_get command */
export class StackGetResponse extends Response {
    /** The current stack trace */
    stack: StackFrame[];
    /**
     * @param  {XMLDocument} document
     * @param  {Connection} connection
     */
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection);
        this.stack = Array.from(document.documentElement.childNodes).map((stackFrameNode: Element) => new StackFrame(stackFrameNode, connection));
    }
}

export class SourceResponse extends Response {
    source: string;
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection);
        this.source = (new Buffer(document.documentElement.textContent, 'base64')).toString();
    }
}

/** A context inside a stack frame, like "Local" or "Superglobals" */
export class Context {
    /** Unique id that is used for further commands */
    id: number;
    /** UI-friendly name like "Local" or "Superglobals" */
    name: string;
    /** The stackframe this context belongs to */
    stackFrame: StackFrame;
    /**
     * @param  {Element} contextNode
     * @param  {StackFrame} stackFrame
     */
    constructor(contextNode: Element, stackFrame: StackFrame) {
        this.id = parseInt(contextNode.getAttribute('id'));
        this.name = contextNode.getAttribute('name');
        this.stackFrame = stackFrame;
    }
    /**
     * Returns the properties (variables) inside this context by doing a context_get command
     * @returns Promise.<Property[]>
     */
    public getProperties(): Promise<Property[]> {
        return this.stackFrame.connection.sendContextGetCommand(this).then(response => response.properties);
    }
}

/** Response to a context_names command */
export class ContextNamesResponse extends Response {
    /** the available contexts inside the given stack frame */
    contexts: Context[];
    /**
     * @param  {XMLDocument} document
     * @param  {StackFrame} stackFrame
     */
    constructor(document: XMLDocument, stackFrame: StackFrame) {
        super(document, stackFrame.connection);
        this.contexts = Array.from(document.documentElement.childNodes).map((contextNode: Element) => new Context(contextNode, stackFrame));
    }
}

/** The parent for properties inside a scope and properties retrieved through eval requests */
export abstract class BaseProperty {
    /** the short name of the property */
    name: string;
    /** the data type of the variable. Can be string, int, float, bool, array, object, uninitialized, null or resource  */
    type: string;
    /** the class if the type is object */
    class: string;
    /** a boolean indicating wether children of this property can be received or not. This is true for arrays and objects. */
    hasChildren: boolean;
    /** the number of children this property has, if any. Useful for showing array length. */
    numberOfChildren: number;
    /** the value of the property for primitive types */
    value: string;
    constructor(propertyNode: Element) {
        if (propertyNode.hasAttribute('name')) {
            this.name = propertyNode.getAttribute('name');
        }
        this.type = propertyNode.getAttribute('type');
        if (propertyNode.hasAttribute('classname')) {
            this.class = propertyNode.getAttribute('classname');
        }
        this.hasChildren = !!parseInt(propertyNode.getAttribute('children'));
        if (this.hasChildren) {
            this.numberOfChildren = parseInt(propertyNode.getAttribute('numchildren'));
        } else {
            const encoding = propertyNode.getAttribute('encoding');
            if (encoding) {
                this.value = iconv.encode(propertyNode.textContent, encoding) + '';
            } else {
                this.value = propertyNode.textContent;
            }
        }
    }
}

/** a property (variable) inside a context or a child of another property */
export class Property extends BaseProperty {
    /** the fully-qualified name of the property inside the context */
    fullName: string;
    /** the context this property belongs to */
    context: Context;
    /**
     * @param  {Element} propertyNode
     * @param  {Context} context
     */
    constructor(propertyNode: Element, context: Context) {
        super(propertyNode);
        this.fullName = propertyNode.getAttribute('fullname');
        this.context = context;
    }
    /**
     * Returns the child properties of this property by doing another property_get
     * @returns Promise.<Property[]>
     */
    public getChildren(): Promise<Property[]> {
        if (!this.hasChildren) {
            return Promise.reject<Property[]>(new Error('This property has no children'));
        }
        return this.context.stackFrame.connection.sendPropertyGetCommand(this).then(response => response.children);
    }
}

/** The response to a context_get command */
export class ContextGetResponse extends Response {
    /** the available properties inside the context */
    properties: Property[];
    /**
     * @param  {XMLDocument} document
     * @param  {Context} context
     */
    constructor(document: XMLDocument, context: Context) {
        super(document, context.stackFrame.connection);
        this.properties = Array.from(document.documentElement.childNodes).map((propertyNode: Element) => new Property(propertyNode, context));
    }
}

/** The response to a property_get command */
export class PropertyGetResponse extends Response {
    /** the children of the given property */
    children: Property[];
    /**
     * @param  {XMLDocument} document
     * @param  {Property} property
     */
    constructor(document: XMLDocument, property: Property) {
        super(document, property.context.stackFrame.connection);
        this.children = Array.from(document.documentElement.firstChild.childNodes).map((propertyNode: Element) => new Property(propertyNode, property.context));
    }
}

/** class for properties returned from eval commands. These don't have a full name or an ID, but have all children already inlined. */
export class EvalResultProperty extends BaseProperty {
    children: EvalResultProperty[];
    constructor(propertyNode: Element) {
        super(propertyNode);
        if (this.hasChildren) {
            this.children = Array.from(propertyNode.childNodes).map((propertyNode: Element) => new EvalResultProperty(propertyNode));
        }
    }
}

/** The response to an eval command */
export class EvalResponse extends Response {
    /** the result of the expression, if there was any */
    result: EvalResultProperty;
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection);
        if (document.documentElement.hasChildNodes()) {
            this.result = new EvalResultProperty(<Element>document.documentElement.firstChild);
        }
    }
}

/** The response to an feature_set command */
export class FeatureSetResponse extends Response {
    /** the feature that was set */
    feature: string;
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection);
        this.feature = document.documentElement.getAttribute('feature');
    }
}

/** A command inside the queue */
interface Command {
    /** The name of the command, like breakpoint_list */
    name: string;
    /** All arguments as one string */
    args?: string;
    /** Data that gets appended after an " -- " in base64 */
    data?: string;
    /** callback that gets called with an XML document when a response arrives that could be parsed */
    resolveFn: (response: XMLDocument) => any;
    /** callback that gets called if an error happened while parsing the response */
    rejectFn: (error?: Error) => any;
}

/**
 * This class represents a connection to XDebug and is instantiated with a socket.
 */
export class Connection extends DbgpConnection {

    /** a counter for unique connection IDs */
    private static _connectionCounter = 1;

    /** unique connection ID */
    public id: number;

    /** the time this connection was established */
    public timeEstablished: Date;

    /** a counter for unique transaction IDs. */
    private _transactionCounter = 1;

    /** the promise that gets resolved once we receive the init packet */
    private _initPromise: Promise<InitPacket>;

    /** resolves the init promise */
    private _initPromiseResolveFn: (initPackt: InitPacket) => any;

    /**
     * a map from transaction IDs to pending commands that have been sent to XDebug and are awaiting a response.
     * This should in theory only contain max one element at any time.
     */
    private _pendingCommands = new Map<number, Command>();

    /**
     * XDebug does NOT support async communication.
     * This means before sending a new command, we have to wait until we get a response for the previous.
     * This array is a stack of commands that get passed to _sendCommand once XDebug can accept commands again.
     */
    private _commandQueue: Command[] = [];

    /** Constructs a new connection that uses the given socket to communicate with XDebug. */
    constructor(socket: net.Socket) {
        super(socket);
        this.id = Connection._connectionCounter++;
        this.timeEstablished = new Date();
        this._initPromise = new Promise<InitPacket>((resolve, reject) => {
            this._initPromiseResolveFn = resolve;
        });
        console.log('New XDebug Connection #' + this.id);
    }

    /** Returns a promise that gets resolved once the init packet arrives */
    public waitForInitPacket(): Promise<InitPacket> {
        return this._initPromise;
    }

    /**
     * Handles a response by firing and then removing a pending transaction callback.
     * After that, the next command in the queue is executed (if there is any).
     */
    protected handleResponse(response: XMLDocument): void {
        if (response.documentElement.nodeName === 'init') {
            this._initPromiseResolveFn(new InitPacket(response, this));
        } else {
            const transactionId = parseInt(response.documentElement.getAttribute('transaction_id'));
            if (this._pendingCommands.has(transactionId)) {
                const command = this._pendingCommands.get(transactionId);
                this._pendingCommands.delete(transactionId);
                command.resolveFn(response);
            }
            if (this._commandQueue.length > 0) {
                const command = this._commandQueue.shift();
                this._executeCommand(command);
            }
        }
    }

    /**
     * Pushes a new command to the queue that will be executed after all the previous commands have finished and we received a response.
     * If the queue is empty AND there are no pending transactions (meaning we already received a response and XDebug is waiting for
     * commands) the command will be executed emidiatly.
     */
    private _enqueueCommand(name: string, args?: string, data?: string): Promise<XMLDocument> {
        return new Promise((resolveFn, rejectFn) => {
            const command = {name, args, data, resolveFn, rejectFn};
            if (this._commandQueue.length === 0 && this._pendingCommands.size === 0) {
                this._executeCommand(command);
            } else {
                this._commandQueue.push(command);
            }
        });
    }

    /**
     * Sends a command to XDebug with a new transaction ID and calls the callback on the command. This can
     * only be called when XDebug can actually accept commands, which is after we received a response for the
     * previous command.
     */
    private _executeCommand(command: Command): void {
        const transactionId = this._transactionCounter++;
        let commandString = command.name + ' -i ' + transactionId;
        if (command.args) {
            commandString += ' ' + command.args;
        }
        if (command.data) {
            commandString += ' -- ' + (new Buffer(command.data)).toString('base64');
        }
        commandString += '\0';
        const data = iconv.encode(commandString, ENCODING);
        this.write(data);
        this._pendingCommands.set(transactionId, command);
    }

    // ------------------------ status --------------------------------------------

    /** Sends a status command */
    public sendStatusCommand(): Promise<StatusResponse> {
        return this._enqueueCommand('status').then(document => new StatusResponse(document, this));
    }

    // ------------------------ feature negotiation --------------------------------

    /**
     * Sends a feature_get command
     * feature can be one of
     *  - language_supports_threads
     *  - language_name
     *  - language_version
     *  - encoding
     *  - protocol_version
     *  - supports_async
     *  - data_encoding
     *  - breakpoint_languages
     *  - breakpoint_types
     *  - multiple_sessions
     *  - max_children
     *  - max_data
     *  - max_depth
     *  - extended_properties
     * optional features:
     *  - supports_postmortem
     *  - show_hidden
     *  - notify_ok
     * or any command.
     */
    public sendFeatureGetCommand(feature: string): Promise<XMLDocument> {
        return this._enqueueCommand('feature_get', `-n feature`);
    }

    /**
     * Sends a feature_set command
     * feature can be one of
     *  - multiple_sessions
     *  - max_children
     *  - max_data
     *  - max_depth
     *  - extended_properties
     * optional features:
     *  - show_hidden
     *  - notify_ok
     */
    public sendFeatureSetCommand(feature: string, value: string): Promise<FeatureSetResponse> {
        return this._enqueueCommand('feature_set', `-n ${feature} -v ${value}`).then(document => new FeatureSetResponse(document, this));
    }

    // ---------------------------- breakpoints ------------------------------------

    /**
     * Sends a breakpoint_set command that sets a breakpoint.
     * @param {Breakpoint} breakpoint - an instance of LineBreakpoint, ConditionalBreakpoint or ExceptionBreakpoint
     * @returns Promise.<BreakpointSetResponse>
     */
    public sendBreakpointSetCommand(breakpoint: Breakpoint): Promise<BreakpointSetResponse> {
        let args = `-t ${breakpoint.type}`;
        let data: string;
        if (breakpoint instanceof LineBreakpoint) {
            args += ` -f ${breakpoint.fileUri} -n ${breakpoint.line}`;
        } else if (breakpoint instanceof ExceptionBreakpoint) {
            args += ` -x ${breakpoint.exception}`;
        } else if (breakpoint instanceof ConditionalBreakpoint) {
            args += ` -f ${breakpoint.fileUri}`;
            if (typeof breakpoint.line === 'number') {
                args += ` -n ${breakpoint.line}`;
            }
            data = breakpoint.expression;
        }
        return this._enqueueCommand('breakpoint_set', args, data).then(document => new BreakpointSetResponse(document, this));
    }

    /** sends a breakpoint_list command */
    public sendBreakpointListCommand(): Promise<BreakpointListResponse> {
        return this._enqueueCommand('breakpoint_list').then(document => new BreakpointListResponse(document, this));
    }

    /** sends a breakpoint_remove command */
    public sendBreakpointRemoveCommand(breakpoint: Breakpoint): Promise<Response> {
        return this._enqueueCommand('breakpoint_remove', `-d ${breakpoint.id}`).then(document => new Response(document, this));
    }

    // ----------------------------- continuation ---------------------------------

    /** sends a run command */
    public sendRunCommand(): Promise<StatusResponse> {
        return this._enqueueCommand('run').then(document => new StatusResponse(document, this));
    }

    /** sends a step_into command */
    public sendStepIntoCommand(): Promise<StatusResponse> {
        return this._enqueueCommand('step_into').then(document => new StatusResponse(document, this));
    }

    /** sends a step_over command */
    public sendStepOverCommand(): Promise<StatusResponse> {
        return this._enqueueCommand('step_over').then(document => new StatusResponse(document, this));
    }

    /** sends a step_out command */
    public sendStepOutCommand(): Promise<StatusResponse> {
        return this._enqueueCommand('step_out').then(document => new StatusResponse(document, this));
    }

    /** sends a stop command */
    public sendStopCommand(): Promise<StatusResponse> {
        return this._enqueueCommand('stop').then(document => new StatusResponse(document, this));
    }

    // ------------------------------ stack ----------------------------------------

    /** Sends a stack_get command */
    public sendStackGetCommand(): Promise<StackGetResponse> {
        return this._enqueueCommand('stack_get').then(document => new StackGetResponse(document, this));
    }

    public sendSourceCommand(uri: string): Promise<SourceResponse> {
        return this._enqueueCommand('source', `-f ${uri}`).then(document => new SourceResponse(document, this));
    }

    // ------------------------------ context --------------------------------------

    /** Sends a context_names command. */
    public sendContextNamesCommand(stackFrame: StackFrame): Promise<ContextNamesResponse> {
        return this._enqueueCommand('context_names', `-d ${stackFrame.level}`).then(document => new ContextNamesResponse(document, stackFrame));
    }

    /** Sends a context_get comand */
    public sendContextGetCommand(context: Context): Promise<ContextGetResponse> {
        return this._enqueueCommand('context_get', `-d ${context.stackFrame.level} -c ${context.id}`).then(document => new ContextGetResponse(document, context));
    }

    /** Sends a property_get command */
    public sendPropertyGetCommand(property: Property): Promise<PropertyGetResponse> {
        return this._enqueueCommand('property_get', `-d ${property.context.stackFrame.level} -c ${property.context.id} -n ${property.fullName}`).then(document => new PropertyGetResponse(document, property));
    }

    // ------------------------------- eval -----------------------------------------

    /** sends an eval command */
    public sendEvalCommand(expression: string): Promise<EvalResponse> {
        return this._enqueueCommand('eval', null, expression).then(document => new EvalResponse(document, this));
    }
}
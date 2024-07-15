import * as iconv from 'iconv-lite'
import { Transport, DbgpConnection } from './dbgp'
import { ENCODING } from './dbgp'

/** The first packet we receive from Xdebug. Returned by waitForInitPacket() */
export class InitPacket {
    /** The file that was requested as a file:// URI */
    fileUri: string
    /** DBGP version (1.0) */
    protocolVersion: string
    /** language being debugged (PHP) */
    language: string
    /** an IDE key, by default the PC name */
    ideKey: string
    /** a reference to the connection this packet was received from */
    connection: Connection
    /** the version of Xdebug */
    engineVersion: string
    /** the name of the engine */
    engineName: string
    /**
     * @param  {XMLDocument} document - An XML document to read from
     * @param  {Connection} connection
     */
    constructor(document: XMLDocument, connection: Connection) {
        const documentElement = document.documentElement
        this.fileUri = documentElement.getAttribute('fileuri')!
        this.language = documentElement.getAttribute('language')!
        this.protocolVersion = documentElement.getAttribute('protocol_version')!
        this.ideKey = documentElement.getAttribute('idekey')!
        this.engineVersion = documentElement.getElementsByTagName('engine').item(0)?.getAttribute('version') ?? ''
        this.engineName = documentElement.getElementsByTagName('engine').item(0)?.textContent ?? ''
        this.connection = connection
    }
}

/** Error class for errors returned from Xdebug */
export class XdebugError extends Error {
    code: number
    constructor(message: string, code: number) {
        super(message)
        this.code = code
        this.message = message
        this.name = 'XdebugError'
    }
}

/** The base class for all Xdebug responses to commands executed on a connection */
export class Response {
    /** A unique transaction ID that matches the one in the request */
    transactionId: number
    /** The command that this is an answer for */
    command: string
    /** The connection this response was received from */
    connection: Connection
    /**
     * constructs a new Response object from an XML document.
     * If there is an error child node, an exception is thrown with the appropriate code and message.
     *
     * @param  {XMLDocument} document - An XML document to read from
     * @param  {Connection} connection
     */
    constructor(document: XMLDocument, connection: Connection) {
        const documentElement = document.documentElement
        if (documentElement.firstChild && documentElement.firstChild.nodeName === 'error') {
            const errorNode = <Element>documentElement.firstChild
            const code = parseInt(errorNode.getAttribute('code')!)
            const message = errorNode.textContent!
            throw new XdebugError(message, code)
        }
        this.transactionId = parseInt(documentElement.getAttribute('transaction_id')!)
        this.command = documentElement.getAttribute('command')!
        this.connection = connection
    }
}

/** A response to the status command */
export class StatusResponse extends Response {
    /** The current status. Can be 'break', ... */
    status: string
    /** The reason for being in this status, can be 'ok', ... */
    reason: string
    /** Contains the file URI if the status is 'break' */
    fileUri: string
    /** Contains the line number if the status is 'break' */
    line: number
    /** Contains info about the exception if the reason for breaking was an exception */
    exception: {
        name: string
        message: string
        code?: number
    }
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection)
        const documentElement = document.documentElement
        this.status = documentElement.getAttribute('status')!
        this.reason = documentElement.getAttribute('reason')!
        if (documentElement.hasChildNodes()) {
            const messageNode = <Element>documentElement.firstChild
            if (messageNode.hasAttribute('exception')) {
                this.exception = {
                    name: messageNode.getAttribute('exception')!,
                    message: messageNode.textContent!,
                }
                if (messageNode.hasAttribute('code')) {
                    this.exception.code = parseInt(messageNode.getAttribute('code')!)
                }
            }
            if (messageNode.hasAttribute('filename')) {
                this.fileUri = messageNode.getAttribute('filename')!
            }
            if (messageNode.hasAttribute('lineno')) {
                this.line = parseInt(messageNode.getAttribute('lineno')!)
            }
        }
    }
}

export type NotifyName = 'breakpoint_resolved' | 'user'
export type HitCondition = '>=' | '==' | '%'

/** Abstract base class for all notify packets */
export class Notify {
    /** Name of the notify */
    name: string
    /** dynamically detects the type of notify and returns the appropriate object */
    public static fromXml(document: XMLDocument, connection: Connection) {
        switch (<NotifyName>document.documentElement.getAttribute('name')!) {
            case 'breakpoint_resolved':
                return new BreakpointResolvedNotify(document, connection)
            case 'user':
                return new UserNotify(document, connection)
            default:
                return new Notify(document)
        }
    }
    /** Constructs a notify object from an XML node from a Xdebug response */
    constructor(document: XMLDocument) {
        this.name = document.documentElement.getAttribute('name')!
    }
}

/** Class for breakpoint_resolved notify */
export class BreakpointResolvedNotify extends Notify {
    /** breakpoint being resolved */
    breakpoint: Breakpoint
    /** Constructs a notify object from an XML node from a Xdebug response */
    constructor(document: XMLDocument, connection: Connection) {
        super(document)
        this.breakpoint = Breakpoint.fromXml(<Element>document.documentElement.firstChild, connection)
    }
}

/** Class for user notify */
export class UserNotify extends Notify {
    /** property of notify value */
    property: EvalResultProperty
    /** File URI of the notify event */
    fileUri: string
    /** Line of notify event */
    line: number

    /** Constructs a notify object from an XML node from a Xdebug response */
    constructor(document: XMLDocument, connection: Connection) {
        super(document)
        if (document.documentElement.hasChildNodes()) {
            const properties = document.documentElement.getElementsByTagName('property')
            if (properties.length > 0) {
                this.property = new EvalResultProperty(properties[0])
                // Name is required by DAP, but user notify does not set it
                this.property.name = ''
            }
            const locations = document.documentElement.getElementsByTagName('xdebug:location')
            if (locations.length > 0) {
                this.line = parseInt(locations[0].getAttribute('lineno')!)
                this.fileUri = locations[0].getAttribute('filename')!
            }
        }
    }
}

export class Stream {
    /** Type of stream */
    type: string
    /** Data of the stream */
    value: string

    /** Constructs a stream object from an XML node from a Xdebug response */
    constructor(document: XMLDocument) {
        this.type = document.documentElement.getAttribute('type')!
        const encoding = document.documentElement.getAttribute('encoding')
        if (encoding) {
            this.value = iconv.encode(document.documentElement.textContent!, encoding).toString()
        } else {
            this.value = document.documentElement.textContent!
        }
    }
}

export type BreakpointType = 'line' | 'call' | 'return' | 'exception' | 'conditional' | 'watch'
export type BreakpointState = 'enabled' | 'disabled'
export type BreakpointResolved = 'resolved' | 'unresolved'

/** Abstract base class for all breakpoints */
export abstract class Breakpoint {
    /** Unique ID which is used for modifying the breakpoint (only when received through breakpoint_list) */
    id: number
    /** The type of the breakpoint: line, call, return, exception, conditional or watch */
    type: BreakpointType
    /** State of the breakpoint: enabled, disabled */
    state: BreakpointState
    /** Flag to denote whether a breakpoint has been resolved */
    resolved: BreakpointResolved
    /** A numeric value used together with the hit_condition to determine if the breakpoint should pause execution or be skipped. */
    hitValue?: number
    /**
     * A string indicating a condition to use to compare hit_count and hit_value.
     * The following values are legal:
     * >= break if hit_count is greater than or equal to hit_value [default]
     * == break if hit_count is equal to hit_value
     * %  break if hit_count is a multiple of hit_value
     */
    hitCondition?: HitCondition
    /** The connection this breakpoint is set on */
    connection: Connection
    /** dynamically detects the type of breakpoint and returns the appropriate object */
    public static fromXml(breakpointNode: Element, connection: Connection): Breakpoint {
        switch (breakpointNode.getAttribute('type')) {
            case 'exception':
                return new ExceptionBreakpoint(breakpointNode, connection)
            case 'line':
                return new LineBreakpoint(breakpointNode, connection)
            case 'conditional':
                return new ConditionalBreakpoint(breakpointNode, connection)
            case 'call':
                return new CallBreakpoint(breakpointNode, connection)
            default:
                throw new Error(`Invalid type ${breakpointNode.getAttribute('type')!}`)
        }
    }
    /** Constructs a breakpoint object from an XML node from a Xdebug response */
    constructor(breakpointNode: Element, connection: Connection)
    /** To create a new breakpoint in derived classes */
    constructor(type: BreakpointType, hitCondition?: HitCondition, hitValue?: number)
    constructor() {
        if (typeof arguments[0] === 'object') {
            // from XML
            const breakpointNode: Element = arguments[0] as Element
            this.connection = arguments[1] as Connection
            this.type = <BreakpointType>breakpointNode.getAttribute('type')
            this.id = parseInt(breakpointNode.getAttribute('id')!)
            this.state = <BreakpointState>breakpointNode.getAttribute('state')
            this.resolved = <BreakpointResolved>breakpointNode.getAttribute('resolved')
            if (breakpointNode.hasAttribute('hit_condition')) {
                this.hitCondition = <HitCondition>breakpointNode.getAttribute('hit_condition')
            }
            if (breakpointNode.hasAttribute('hit_value')) {
                this.hitValue = parseInt(breakpointNode.getAttribute('hit_value')!)
            }
        } else {
            this.type = arguments[0] as BreakpointType
            this.hitCondition = arguments[1] as HitCondition | undefined
            this.hitValue = arguments[2] as number | undefined
        }
    }
    /** Removes the breakpoint by sending a breakpoint_remove command */
    public remove() {
        return this.connection.sendBreakpointRemoveCommand(this)
    }
}

/** class for line breakpoints. Returned from a breakpoint_list or passed to sendBreakpointSetCommand */
export class LineBreakpoint extends Breakpoint {
    /** File URI of the file in which to break */
    fileUri: string
    /** Line to break on */
    line: number
    /** constructs a line breakpoint from an XML node */
    constructor(breakpointNode: Element, connection: Connection)
    /** constructs a line breakpoint for passing to sendSetBreakpointCommand */
    constructor(fileUri: string, line: number, hitCondition?: HitCondition, hitValue?: number)
    constructor() {
        if (typeof arguments[0] === 'object') {
            const breakpointNode: Element = arguments[0] as Element
            const connection: Connection = arguments[1] as Connection
            super(breakpointNode, connection)
            this.line = parseInt(breakpointNode.getAttribute('lineno')!)
            this.fileUri = breakpointNode.getAttribute('filename')!
        } else {
            // construct from arguments
            super('line', arguments[2] as HitCondition, arguments[3] as number)
            this.fileUri = arguments[0] as string
            this.line = arguments[1] as number
        }
    }
}

/** class for call breakpoints. Returned from a breakpoint_list or passed to sendBreakpointSetCommand */
export class CallBreakpoint extends Breakpoint {
    /** the function to break on */
    fn: string
    /** optional expression that must evaluate to true */
    expression: string
    /** constructs a call breakpoint from an XML node */
    constructor(breakpointNode: Element, connection: Connection)
    /** constructs a call breakpoint for passing to sendSetBreakpointCommand */
    constructor(fn: string, expression?: string, hitCondition?: HitCondition, hitValue?: number)
    constructor() {
        if (typeof arguments[0] === 'object') {
            const breakpointNode: Element = arguments[0] as Element
            const connection: Connection = arguments[1] as Connection
            super(breakpointNode, connection)
            this.fn = breakpointNode.getAttribute('function')!
            this.expression = breakpointNode.getAttribute('expression')! // Base64 encoded?
        } else {
            // construct from arguments
            super('call', arguments[2] as HitCondition, arguments[3] as number)
            this.fn = arguments[0] as string
            this.expression = arguments[1] as string
        }
    }
}

/** class for exception breakpoints. Returned from a breakpoint_list or passed to sendBreakpointSetCommand */
export class ExceptionBreakpoint extends Breakpoint {
    /** The Exception name to break on. Can also contain wildcards. */
    exception: string
    /** Constructs a breakpoint object from an XML node from a Xdebug response */
    constructor(breakpointNode: Element, connection: Connection)
    /** Constructs a breakpoint for passing it to sendSetBreakpointCommand */
    constructor(exception: string, hitCondition?: HitCondition, hitValue?: number)
    constructor() {
        if (typeof arguments[0] === 'object') {
            // from XML
            const breakpointNode: Element = arguments[0] as Element
            const connection: Connection = arguments[1] as Connection
            super(breakpointNode, connection)
            this.exception = breakpointNode.getAttribute('exception')!
        } else {
            // from arguments
            super('exception', arguments[1] as HitCondition, arguments[2] as number)
            this.exception = arguments[0] as string
        }
    }
}

/** class for conditional breakpoints. Returned from a breakpoint_list or passed to sendBreakpointSetCommand */
export class ConditionalBreakpoint extends Breakpoint {
    /** File URI */
    fileUri: string
    /** Line (optional) */
    line: number
    /** The PHP expression under which to break on */
    expression: string
    /** Constructs a breakpoint object from an XML node from a Xdebug response */
    constructor(breakpointNode: Element, connection: Connection)
    /** Constructs a breakpoint object for passing to sendSetBreakpointCommand */
    constructor(expression: string, fileUri: string, line?: number, hitCondition?: HitCondition, hitValue?: number)
    constructor() {
        if (typeof arguments[0] === 'object') {
            // from XML
            const breakpointNode: Element = arguments[0] as Element
            const connection: Connection = arguments[1] as Connection
            super(breakpointNode, connection)
            this.expression = breakpointNode.getAttribute('expression')! // Base64 encoded?
        } else {
            // from arguments
            super('conditional', arguments[3] as HitCondition, arguments[4] as number)
            this.expression = arguments[0] as string
            this.fileUri = arguments[1] as string
            this.line = arguments[2] as number
        }
    }
}

/** Response to a breakpoint_set command */
export class BreakpointSetResponse extends Response {
    breakpointId: number
    resolved: BreakpointResolved
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection)
        this.breakpointId = parseInt(document.documentElement.getAttribute('id')!)
        this.resolved = <BreakpointResolved>document.documentElement.getAttribute('resolved')
    }
}

/** The response to a breakpoint_list command */
export class BreakpointListResponse extends Response {
    /** The currently set breakpoints for this connection */
    breakpoints: Breakpoint[]
    /**
     * @param  {XMLDocument} document
     * @param  {Connection} connection
     */
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection)
        this.breakpoints = Array.from(document.documentElement.childNodes).map((breakpointNode: Element) =>
            Breakpoint.fromXml(breakpointNode, connection)
        )
    }
}

/** The response to a breakpoint_get command */
export class BreakpointGetResponse extends Response {
    /** The currently set breakpoints for this connection */
    breakpoint: Breakpoint
    /**
     * @param  {XMLDocument} document
     * @param  {Connection} connection
     */
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection)
        this.breakpoint = Breakpoint.fromXml(<Element>document.documentElement.firstChild, connection)
    }
}

/** One stackframe inside a stacktrace retrieved through stack_get */
export class StackFrame {
    /** The UI-friendly name of this stack frame, like a function name or "{main}" */
    name: string
    /** The type of stack frame. Valid values are "file" and "eval" */
    type: string
    /** The file URI where the stackframe was entered */
    fileUri: string
    /** The line number inside file where the stackframe was entered */
    line: number
    /** The level (index) inside the stack trace at which the stack frame resides */
    level: number
    /** The connection this stackframe belongs to */
    connection: Connection
    /**
     * @param  {Element} stackFrameNode
     * @param  {Connection} connection
     */
    constructor(stackFrameNode: Element, connection: Connection) {
        this.name = stackFrameNode.getAttribute('where')!
        this.fileUri = stackFrameNode.getAttribute('filename')!
        this.type = stackFrameNode.getAttribute('type')!
        this.line = parseInt(stackFrameNode.getAttribute('lineno')!)
        this.level = parseInt(stackFrameNode.getAttribute('level')!)
        this.connection = connection
    }
    /** Returns the available contexts (scopes, such as "Local" and "Superglobals") by doing a context_names command */
    public async getContexts(): Promise<Context[]> {
        return (await this.connection.sendContextNamesCommand(this)).contexts
    }
}

/** The response to a stack_get command */
export class StackGetResponse extends Response {
    /** The current stack trace */
    stack: StackFrame[]
    /**
     * @param  {XMLDocument} document
     * @param  {Connection} connection
     */
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection)
        this.stack = Array.from(document.documentElement.childNodes).map(
            (stackFrameNode: Element) => new StackFrame(stackFrameNode, connection)
        )
    }
}

export class SourceResponse extends Response {
    source: string
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection)
        this.source = Buffer.from(document.documentElement.textContent!, 'base64').toString()
    }
}

/** A context inside a stack frame, like "Local" or "Superglobals" */
export class Context {
    /** Unique id that is used for further commands */
    id: number
    /** UI-friendly name like "Local" or "Superglobals" */
    name: string
    /** The stackframe this context belongs to */
    stackFrame: StackFrame
    /**
     * @param  {Element} contextNode
     * @param  {StackFrame} stackFrame
     */
    constructor(contextNode: Element, stackFrame: StackFrame) {
        this.id = parseInt(contextNode.getAttribute('id')!)
        this.name = contextNode.getAttribute('name')!
        this.stackFrame = stackFrame
    }
    /**
     * Returns the properties (variables) inside this context by doing a context_get command
     *
     * @returns Promise.<Property[]>
     */
    public async getProperties(): Promise<Property[]> {
        return (await this.stackFrame.connection.sendContextGetCommand(this)).properties
    }
}

/** Response to a context_names command */
export class ContextNamesResponse extends Response {
    /** the available contexts inside the given stack frame */
    contexts: Context[]
    /**
     * @param  {XMLDocument} document
     * @param  {StackFrame} stackFrame
     */
    constructor(document: XMLDocument, stackFrame: StackFrame) {
        super(document, stackFrame.connection)
        this.contexts = Array.from(document.documentElement.childNodes).map(
            (contextNode: Element) => new Context(contextNode, stackFrame)
        )
    }
}

/** The parent for properties inside a scope and properties retrieved through eval requests */
export abstract class BaseProperty {
    /** the short name of the property */
    name: string
    /** the data type of the variable. Can be string, int, float, bool, array, object, uninitialized, null or resource  */
    type: string
    /** the class if the type is object */
    class: string
    /** a boolean indicating wether children of this property can be received or not. This is true for arrays and objects. */
    hasChildren: boolean
    /** the number of children this property has, if any. Useful for showing array length. */
    numberOfChildren: number
    /** the value of the property for primitive types */
    value: string
    /** children that were already included in the response */
    children: BaseProperty[]
    /** provided facets */
    facets: ('public' | 'private' | 'protected' | 'static' | 'readonly' | string)[]

    constructor(propertyNode: Element | null) {
        if (propertyNode === null) {
            return
        }
        if (propertyNode.hasAttribute('name')) {
            this.name = propertyNode.getAttribute('name')!
        } else if (propertyNode.getElementsByTagName('name').length > 0) {
            this.name = decodeTag(propertyNode, 'name')
        }
        this.type = propertyNode.getAttribute('type')!
        if (propertyNode.hasAttribute('classname')) {
            this.class = propertyNode.getAttribute('classname')!
        } else if (propertyNode.getElementsByTagName('classname').length > 0) {
            this.class = decodeTag(propertyNode, 'classname')
        }
        if (propertyNode.hasAttribute('facet')) {
            this.facets = propertyNode.getAttribute('facet')!.split(' ')
        }
        this.hasChildren = !!parseInt(propertyNode.getAttribute('children')!)
        if (this.hasChildren) {
            this.numberOfChildren = parseInt(propertyNode.getAttribute('numchildren')!)
        } else {
            if (propertyNode.getElementsByTagName('value').length > 0) {
                this.value = decodeTag(propertyNode, 'value')
            } else {
                const encoding = propertyNode.getAttribute('encoding')
                if (encoding) {
                    this.value = iconv.encode(propertyNode.textContent!, encoding).toString()
                } else {
                    this.value = propertyNode.textContent!
                }
            }
        }
    }
}

/** a property (variable) inside a context or a child of another property */
export class Property extends BaseProperty {
    /** the fully-qualified name of the property inside the context */
    fullName: string
    /** the context this property belongs to */
    context: Context

    children: Property[]

    /**
     * @param  {Element} propertyNode
     * @param  {Context} context
     */
    constructor(propertyNode: Element, context: Context) {
        super(propertyNode)
        if (propertyNode.hasAttribute('fullname')) {
            this.fullName = propertyNode.getAttribute('fullname')!
        } else if (propertyNode.getElementsByTagName('fullname').length > 0) {
            this.fullName = decodeTag(propertyNode, 'fullname')
        }
        this.context = context
        if (this.hasChildren) {
            this.children = Array.from(propertyNode.childNodes)
                .filter(node => node.nodeName === 'property')
                .map((propertyNode: Element) => new Property(propertyNode, context))
        }
    }

    /**
     * Sets the value of this property through a property_set command
     */
    public set(value: string): Promise<Response> {
        return this.context.stackFrame.connection.sendPropertySetCommand(this, value)
    }

    /**
     * Returns the child properties of this property by doing another property_get
     *
     * @returns Promise.<Property[]>
     */
    public async getChildren(page: number = 0): Promise<Property[]> {
        if (!this.hasChildren) {
            throw new Error('This property has no children')
        }
        return (await this.context.stackFrame.connection.sendPropertyGetCommand(this, page)).children
    }
}

function decodeTag(propertyNode: Element, tagName: string): string {
    const tag = propertyNode.getElementsByTagName(tagName).item(0)!
    const encoding = tag.getAttribute('encoding')
    if (encoding) {
        return iconv.encode(tag.textContent!, encoding).toString()
    } else {
        return tag.textContent!
    }
}

export class SyntheticProperty extends BaseProperty {
    constructor(name: string, type: string, value: string, children: BaseProperty[]) {
        super(null)
        this.name = name
        this.type = type
        this.value = value
        this.hasChildren = children.length > 0
        this.numberOfChildren = children.length
        this.children = children
    }
}

/** The response to a context_get command */
export class ContextGetResponse extends Response {
    /** the available properties inside the context */
    properties: Property[]
    /**
     * @param  {XMLDocument} document
     * @param  {Context} context
     */
    constructor(document: XMLDocument, context: Context) {
        super(document, context.stackFrame.connection)
        this.properties = Array.from(document.documentElement.childNodes).map(
            (propertyNode: Element) => new Property(propertyNode, context)
        )
    }
}

/** The response to a property_get command */
export class PropertyGetResponse extends Response {
    /** the children of the given property */
    children: Property[]
    /**
     * @param  {XMLDocument} document
     * @param  {Context} context
     */
    constructor(document: XMLDocument, context: Context) {
        super(document, context.stackFrame.connection)
        this.children = Array.from(document.documentElement.firstChild!.childNodes)
            .filter(node => node.nodeName === 'property')
            .map((propertyNode: Element) => new Property(propertyNode, context))
    }
}

/** The response to a property_get by name command */
export class PropertyGetNameResponse extends Response {
    /** The property being resolved */
    property: Property
    /**
     * @param  {XMLDocument} document
     * @param  {Context} context
     */
    constructor(document: XMLDocument, context: Context) {
        super(document, context.stackFrame.connection)
        this.property = new Property(<Element>document.documentElement.firstChild!, context)
    }
}

/** class for properties returned from eval commands. These don't have a full name or an ID, but have all children already inlined. */
export class EvalResultProperty extends BaseProperty {
    children: EvalResultProperty[]
    constructor(propertyNode: Element) {
        super(propertyNode)
        if (this.hasChildren) {
            this.children = Array.from(propertyNode.childNodes)
                .filter(node => node.nodeName === 'property')
                .map((propertyNode: Element) => new EvalResultProperty(propertyNode))
        }
    }
}

/** The response to an eval command */
export class EvalResponse extends Response {
    /** the result of the expression, if there was any */
    result: EvalResultProperty
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection)
        if (document.documentElement.hasChildNodes()) {
            this.result = new EvalResultProperty(<Element>document.documentElement.firstChild)
        }
    }
}

/** The response to a feature_set command */
export class FeatureSetResponse extends Response {
    /** the feature that was set */
    feature: string
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection)
        this.feature = document.documentElement.getAttribute('feature')!
    }
}

/** The response to a feature_get command */
export class FeatureGetResponse extends Response {
    /** the feature is supported */
    supported: '0' | '1'
    /** the feature name */
    feature: string
    constructor(document: XMLDocument, connection: Connection) {
        super(document, connection)
        this.feature = document.documentElement.getAttribute('feature')!
        this.supported = <'0' | '1'>document.documentElement.getAttribute('supported')!
    }
}

/** A command inside the queue */
interface Command {
    /** The name of the command, like breakpoint_list */
    name: string
    /** All arguments as one string */
    args?: string
    /** Data that gets appended after an " -- " in base64 */
    data?: string
    /** callback that gets called with an XML document when a response arrives that could be parsed */
    resolveFn: (response: XMLDocument) => void
    /** callback that gets called if an error happened while parsing the response */
    rejectFn: (error?: Error) => void
    /** whether command results in PHP code being executed or not */
    isExecuteCommand: boolean
}

/**
 * Escapes a value to pass it as an argument in an XDebug command
 */
function escape(value: string): string {
    return '"' + value.replace(/("|\\)/g, '\\$1') + '"'
}

export declare interface Connection extends DbgpConnection {
    on(event: 'message', listener: (document: Document) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'close', listener: () => void): this
    on(event: 'warning', listener: (warning: string) => void): this
    on(event: 'log', listener: (text: string) => void): this
    on(event: 'notify_user', listener: (notify: UserNotify) => void): this
    on(event: 'notify_breakpoint_resolved', listener: (notify: BreakpointResolvedNotify) => void): this
    on(event: 'stream', listener: (stream: Stream) => void): this
}

/**
 * This class represents a connection to Xdebug and is instantiated with a socket.
 */
export class Connection extends DbgpConnection {
    /** a counter for unique connection IDs */
    private static _connectionCounter = 1

    /** unique connection ID */
    public id: number

    /** the time this connection was established */
    public timeEstablished: Date

    /** a counter for unique transaction IDs. */
    private _transactionCounter = 1

    /** the promise that gets resolved once we receive the init packet */
    private _initPromise: Promise<InitPacket>

    /** resolves the init promise */
    private _initPromiseResolveFn: (initPacket: InitPacket) => void

    /** rejects the init promise */
    private _initPromiseRejectFn: (err?: Error) => void

    /**
     * a map from transaction IDs to pending commands that have been sent to Xdebug and are awaiting a response.
     * This should in theory only contain max one element at any time.
     */
    private _pendingCommands = new Map<number, Command>()

    /**
     * Xdebug does NOT support async communication.
     * This means before sending a new command, we have to wait until we get a response for the previous.
     * This array is a stack of commands that get passed to _sendCommand once Xdebug can accept commands again.
     */
    private _commandQueue: Command[] = []

    private _pendingExecuteCommand = false
    /**
     * Whether a command was started that executes PHP, which means the connection will be blocked from
     * running any additional commands until the execution gets to the next stopping point or exits.
     */
    public get isPendingExecuteCommand(): boolean {
        return this._pendingExecuteCommand
    }

    /** Constructs a new connection that uses the given socket to communicate with Xdebug. */
    constructor(socket: Transport) {
        super(socket)
        this.id = Connection._connectionCounter++
        this.timeEstablished = new Date()
        this._initPromise = new Promise<InitPacket>((resolve, reject) => {
            this._initPromiseResolveFn = resolve
            this._initPromiseRejectFn = reject
        })
        this.on('message', (response: XMLDocument) => {
            if (response.documentElement.nodeName === 'init') {
                this._initPromiseResolveFn(new InitPacket(response, this))
            } else if (response.documentElement.nodeName === 'notify') {
                const n = Notify.fromXml(response, this)
                this.emit('notify_' + n.name, n)
            } else if (response.documentElement.nodeName === 'stream') {
                const s = new Stream(response)
                this.emit('stream', s)
            } else {
                const transactionId = parseInt(response.documentElement.getAttribute('transaction_id')!)
                if (this._pendingCommands.has(transactionId)) {
                    const command = this._pendingCommands.get(transactionId)!
                    this._pendingCommands.delete(transactionId)
                    this._pendingExecuteCommand = false
                    command.resolveFn(response)
                }
                if (this._commandQueue.length > 0) {
                    const command = this._commandQueue.shift()!
                    this._executeCommand(command).catch(command.rejectFn)
                }
            }
        })
        this.on('close', () => {
            this._pendingCommands.forEach(command => command.rejectFn(new Error('connection closed (on close)')))
            this._pendingCommands.clear()
            this._commandQueue.forEach(command => command.rejectFn(new Error('connection closed (on close)')))
            this._commandQueue = []
            this._initPromiseRejectFn(new Error('connection closed (on close)'))
        })
    }

    /** Returns a promise that gets resolved once the init packet arrives */
    public waitForInitPacket(): Promise<InitPacket> {
        return this._initPromise
    }

    /**
     * Pushes a new command to the queue that will be executed after all the previous commands have finished and we received a response.
     * If the queue is empty AND there are no pending transactions (meaning we already received a response and Xdebug is waiting for
     * commands) the command will be executed immediately.
     */
    private _enqueueCommand(name: string, args?: string, data?: string): Promise<XMLDocument> {
        return new Promise((resolveFn, rejectFn) => {
            this._enqueue({ name, args, data, resolveFn, rejectFn, isExecuteCommand: false })
        })
    }

    /**
     * Pushes a new execute command (one that results in executing PHP code) to the queue that will be executed after all the previous
     * commands have finished and we received a response.
     * If the queue is empty AND there are no pending transactions (meaning we already received a response and Xdebug is waiting for
     * commands) the command will be executed immediately.
     */
    private _enqueueExecuteCommand(name: string, args?: string, data?: string): Promise<XMLDocument> {
        return new Promise((resolveFn, rejectFn) => {
            this._enqueue({ name, args, data, resolveFn, rejectFn, isExecuteCommand: true })
        })
    }

    /** Adds the given command to the queue, or executes immediately if no commands are currently being processed. */
    private _enqueue(command: Command): void {
        if (this._commandQueue.length === 0 && this._pendingCommands.size === 0) {
            this._executeCommand(command).catch(command.rejectFn)
        } else {
            this._commandQueue.push(command)
        }
    }

    /**
     * Sends a command to Xdebug with a new transaction ID and calls the callback on the command. This can
     * only be called when Xdebug can actually accept commands, which is after we received a response for the
     * previous command.
     */
    private async _executeCommand(command: Command): Promise<void> {
        const transactionId = this._transactionCounter++
        let commandString = `${command.name} -i ${transactionId}`
        if (command.args) {
            commandString += ' ' + command.args
        }
        if (command.data) {
            commandString += ' -- ' + Buffer.from(command.data).toString('base64')
        }
        commandString += '\0'
        const data = iconv.encode(commandString, ENCODING)
        this._pendingCommands.set(transactionId, command)
        this._pendingExecuteCommand = command.isExecuteCommand
        await this.write(data)
    }

    public close() {
        this._commandQueue = []
        this._initPromiseRejectFn(new Error('connection closed (close)'))
        return super.close()
    }

    // ------------------------ status --------------------------------------------

    /** Sends a status command */
    public async sendStatusCommand(): Promise<StatusResponse> {
        return new StatusResponse(await this._enqueueCommand('status'), this)
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
    public async sendFeatureGetCommand(feature: string): Promise<FeatureGetResponse> {
        return new FeatureGetResponse(await this._enqueueCommand('feature_get', `-n ${feature}`), this)
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
    public async sendFeatureSetCommand(feature: string, value: string | number): Promise<FeatureSetResponse> {
        return new FeatureSetResponse(await this._enqueueCommand('feature_set', `-n ${feature} -v ${value}`), this)
    }

    // ---------------------------- breakpoints ------------------------------------

    /**
     * Sends a breakpoint_set command that sets a breakpoint.
     *
     * @param {Breakpoint} breakpoint - an instance of LineBreakpoint, ConditionalBreakpoint or ExceptionBreakpoint
     * @returns Promise.<BreakpointSetResponse>
     */
    public async sendBreakpointSetCommand(breakpoint: Breakpoint): Promise<BreakpointSetResponse> {
        let args = `-t ${breakpoint.type}`
        let data: string | undefined
        if (breakpoint instanceof LineBreakpoint) {
            args += ` -f ${breakpoint.fileUri} -n ${breakpoint.line}`
        } else if (breakpoint instanceof ExceptionBreakpoint) {
            args += ` -x ${breakpoint.exception}`
        } else if (breakpoint instanceof ConditionalBreakpoint) {
            args += ` -f ${breakpoint.fileUri}`
            if (typeof breakpoint.line === 'number') {
                args += ` -n ${breakpoint.line}`
            }
            data = breakpoint.expression
        } else if (breakpoint instanceof CallBreakpoint) {
            args += ` -m ${breakpoint.fn}`
            data = breakpoint.expression
        }
        if (breakpoint.hitCondition) {
            args += ` -o ${breakpoint.hitCondition}`
        }
        if (breakpoint.hitValue) {
            args += ` -h ${breakpoint.hitValue}`
        }
        return new BreakpointSetResponse(await this._enqueueCommand('breakpoint_set', args, data), this)
    }

    /** sends a breakpoint_list command */
    public async sendBreakpointListCommand(): Promise<BreakpointListResponse> {
        return new BreakpointListResponse(await this._enqueueCommand('breakpoint_list'), this)
    }

    /**
     * Sends a breakpoint_get command
     *
     * @param {Breakpoint|number} breakpoint - an instance or id of a breakpoint
     * @returns Promise.<BreakpointGetResponse>
     */
    public async sendBreakpointGetCommand(breakpoint: Breakpoint | number): Promise<BreakpointGetResponse> {
        let breakpointId: number
        if (typeof breakpoint === 'number') {
            breakpointId = breakpoint
        } else {
            breakpointId = breakpoint.id
        }
        return new BreakpointGetResponse(await this._enqueueCommand('breakpoint_get', `-d ${breakpointId}`), this)
    }

    /** sends a breakpoint_remove command */
    public async sendBreakpointRemoveCommand(breakpoint: Breakpoint | number): Promise<Response> {
        let breakpointId: number
        if (typeof breakpoint === 'number') {
            breakpointId = breakpoint
        } else {
            breakpointId = breakpoint.id
        }
        return new Response(await this._enqueueCommand('breakpoint_remove', `-d ${breakpointId}`), this)
    }

    // ----------------------------- continuation ---------------------------------

    /** sends a run command */
    public async sendRunCommand(): Promise<StatusResponse> {
        return new StatusResponse(await this._enqueueExecuteCommand('run'), this)
    }

    /** sends a step_into command */
    public async sendStepIntoCommand(): Promise<StatusResponse> {
        return new StatusResponse(await this._enqueueExecuteCommand('step_into'), this)
    }

    /** sends a step_over command */
    public async sendStepOverCommand(): Promise<StatusResponse> {
        return new StatusResponse(await this._enqueueExecuteCommand('step_over'), this)
    }

    /** sends a step_out command */
    public async sendStepOutCommand(): Promise<StatusResponse> {
        return new StatusResponse(await this._enqueueExecuteCommand('step_out'), this)
    }

    /** sends a stop command */
    public async sendStopCommand(): Promise<StatusResponse> {
        return new StatusResponse(await this._enqueueCommand('stop'), this)
    }

    // ------------------------------ stack ----------------------------------------

    /** Sends a stack_get command */
    public async sendStackGetCommand(): Promise<StackGetResponse> {
        return new StackGetResponse(await this._enqueueCommand('stack_get'), this)
    }

    public async sendSourceCommand(uri: string): Promise<SourceResponse> {
        return new SourceResponse(await this._enqueueCommand('source', `-f ${uri}`), this)
    }

    // ------------------------------ context --------------------------------------

    /** Sends a context_names command. */
    public async sendContextNamesCommand(stackFrame: StackFrame): Promise<ContextNamesResponse> {
        return new ContextNamesResponse(
            await this._enqueueCommand('context_names', `-d ${stackFrame.level}`),
            stackFrame
        )
    }

    /** Sends a context_get command */
    public async sendContextGetCommand(context: Context): Promise<ContextGetResponse> {
        return new ContextGetResponse(
            await this._enqueueCommand('context_get', `-d ${context.stackFrame.level} -c ${context.id}`),
            context
        )
    }

    // ------------------------------ property --------------------------------------

    /** Sends a property_get command */
    public async sendPropertyGetCommand(property: Property, page: number = 0): Promise<PropertyGetResponse> {
        return new PropertyGetResponse(
            await this._enqueueCommand(
                'property_get',
                `-d ${property.context.stackFrame.level} -c ${property.context.id} -p ${page} -n ${escape(
                    property.fullName
                )}`
            ),
            property.context
        )
    }

    /** Sends a property_get by name command */
    public async sendPropertyGetNameCommand(name: string, context: Context): Promise<PropertyGetNameResponse> {
        const escapedFullName = '"' + name.replace(/("|\\)/g, '\\$1') + '"'
        return new PropertyGetNameResponse(
            await this._enqueueCommand(
                'property_get',
                `-d ${context.stackFrame.level} -c ${context.id} -n ${escapedFullName}`
            ),
            context
        )
    }

    /** Sends a property_set command */
    public async sendPropertySetCommand(property: Property, value: string): Promise<Response> {
        return new Response(
            await this._enqueueCommand(
                'property_set',
                `-d ${property.context.stackFrame.level} -c ${property.context.id} -n ${escape(property.fullName)}`,
                value
            ),
            property.context.stackFrame.connection
        )
    }

    // ------------------------------- eval -----------------------------------------

    /** sends an eval command */
    public async sendEvalCommand(expression: string): Promise<EvalResponse> {
        return new EvalResponse(await this._enqueueCommand('eval', undefined, expression), this)
    }

    // ------------------------------ stream ----------------------------------------

    public async sendStdout(mode: 0 | 1 | 2): Promise<Response> {
        return new Response(await this._enqueueCommand('stdout', `-c ${mode}`), this)
    }

    public async sendStderr(mode: 0 | 1 | 2): Promise<Response> {
        return new Response(await this._enqueueCommand('stderr', `-c ${mode}`), this)
    }
}

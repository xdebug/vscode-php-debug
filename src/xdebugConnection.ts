
import * as net from 'net';
import {EventEmitter} from 'events';
import {parseString} from 'xml2js';
import {Thread} from 'vscode-debugadapter';
import * as iconv from 'iconv-lite';

export class InvalidMessageError extends Error {
    public data: Buffer;
    constructor(data: Buffer) {
        super('Invalid message from XDebug: ' + data.toString('ascii'));
        this.data = data;
    }
}

export interface XMLNode {
    /** The attributes of the XML Node */
    attributes: {
        [attributeName: string]: string;
    };
    /** An array of child nodes */
    childNodes?: {
        [childNodeName: string]: XMLNode[];
    };
    /** Text inside the XML tag */
    content?: string;
}

interface Command {
    name: string;
    args?: string;
    //data?: any;
    resolveFn: (response: XMLNode) => any;
    rejectFn: (error?: Error) => any;
}

/**
 * This class represents a connection to XDebug and is instantiated with a socket.
 * Once the socket receives the init package from XDebug, an init event is fired.
 */
export class XDebugConnection extends EventEmitter {

    private static _connectionCounter = 0;
    private _id: number;
    public get id() {
        return this._id;
    }
    private _timeEstablished: Date;
    public get timeEstablished() {
        return this._timeEstablished;
    }
    private _socket: net.Socket;
    private _transactionCounter = 0;
    private _initPromise: Promise<XMLNode>;

    /**
     * The currently pending command that has been sent to XDebug and is awaiting a response
     */
    private _pendingCommand: Command;

    /**
     * XDebug doesn NOT support async communication.
     * This means before sending a new command, we have to wait until we get a response for the previous.
     * This array is a stack of commands that get passed to _sendCommand once we XDebug can accept commands again.
     */
    private _queue: Command[] = [];

    constructor(socket: net.Socket) {
        super();
        this._id = XDebugConnection._connectionCounter++;
        this._socket = socket;
        this._timeEstablished = new Date();
        socket.on('data', (data: Buffer) => this._handleResponse(data));
        this._initPromise = new Promise((resolveFn, rejectFn) => {
            this._pendingCommand = {name: null, rejectFn, resolveFn};
        });
        console.log('New XDebug Connection #' + this._id);
    }

    public waitForInitPacket(): Promise<XMLNode> {
        return this._initPromise;
    }

    /**
     * Handles a response by firing and then removing a pending transaction callback.
     * If the response is an init packet, an init event is emitted instead.
     * After that, the next command in the queue is executed (if there is any).
     */
    private _handleResponse(data: Buffer): void {
        // XDebug sent us a packet
        // Anatomy: [data length] [NULL] [xml] [NULL]
        const firstNullByte = data.indexOf(0);
        const secondNullByte = data.indexOf(0, firstNullByte + 1);
        if (firstNullByte === -1 || secondNullByte === -1) {
            this._pendingCommand.rejectFn(new InvalidMessageError(data));
            return;
        }
        const dataLength = parseInt(data.toString('ascii', 0, firstNullByte));
        const xmlData = data.slice(firstNullByte + 1, secondNullByte);
        const xml = iconv.decode(xmlData, 'iso-8859-1');
        parseString(xml, {attrkey: 'attributes', childkey: 'childNodes', charkey: 'content', explicitCharkey: true, explicitArray: true, explicitChildren: true, explicitRoot: false}, (err?: Error, result?: XMLNode) => {
            //console.log('#' + this._connectionId + ' received packet from XDebug, packet length ' + dataLength, result);
            //const transactionId = parseInt(result.attributes['transaction_id']);
            const command = this._pendingCommand;
            if (!command) {
                console.error('XDebug sent a response, but there was no pending command');
            } else {
                this._pendingCommand = null;
                if (err) {
                    command.rejectFn(err);
                } else {
                    command.resolveFn(result);
                }
            }
            if (this._queue.length > 0) {
                const command = this._queue.shift();
                this._executeCommand(command);
            }
        });
    }

    /**
     * Pushes a new command to the queue that will be executed after all the previous commands have finished and we received a response.
     * If the queue is empty AND there are no pending transactions (meaning we already received a response and XDebug is waiting for
     * commands) the command will be executed emidiatly.
     */
    private _enqueueCommand(name: string, args?: string): Promise<XMLNode> {
        return new Promise((resolveFn, rejectFn) => {
            const command = {name, args, resolveFn, rejectFn};
            if (this._queue.length === 0 && !this._pendingCommand) {
                this._executeCommand(command);
            } else {
                this._queue.push(command);
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
        commandString += '\0';
        const data = iconv.encode(commandString, 'iso-8859-1');
        this._socket.write(data);
        this._pendingCommand = command;
    }

    // ------------------------ status --------------------------------------------

    /** Sends a status command */
    public status(): Promise<XMLNode> {
        return this._enqueueCommand('status');
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
    public getFeature(feature: string): Promise<XMLNode> {
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
    public setFeature(feature: string, value: string): Promise<XMLNode> {
        return this._enqueueCommand('feature_set', `-n ${feature} -v ${value}`);
    }

    // ---------------------------- breakpoints ------------------------------------

    /**
     * Sends a breakpoint_set command that sets a line breakpoint.
     */
    public setLineBreakpoint(file: string, line: number): Promise<XMLNode> {
        return this._enqueueCommand('breakpoint_set', `-t line -f ${file} -n ${line}`);
    }

    /**
     * Sends a breakpoint_set command that sets an exception breakpoint
     * @param {string} name - the name of the exception class/interface to break on, for example "Exception" or "Throwable"
     */
    public setExceptionBreakpoint(name: string): Promise<XMLNode> {
        return this._enqueueCommand('breakpoint_set', `-t exception -x ${name}`);
    }

    // ----------------------------- continuation ---------------------------------

    public run(): Promise<XMLNode> {
        return this._enqueueCommand('run');
    }

    public stepInto(): Promise<XMLNode> {
        return this._enqueueCommand('step_into');
    }

    public stepOver(): Promise<XMLNode> {
        return this._enqueueCommand('step_over');
    }

    public stepOut(): Promise<XMLNode> {
        return this._enqueueCommand('step_out');
    }

    public stop(): Promise<XMLNode> {
        return this._enqueueCommand('stop').then(response => {
            this._socket.end();
            return response;
        });
    }

    // ------------------------------ stack ----------------------------------------

    /** Sends a stack_get request */
    public getStack(): Promise<XMLNode> {
        return this._enqueueCommand('stack_get');
    }

    // ------------------------------ context --------------------------------------

    /** Sends a context_names command. */
    public getContextNames(stackDepth: number): Promise<XMLNode> {
        return this._enqueueCommand('context_names');
    }

    /** Sends a context_get comand */
    public getContext(stackDepth: number, contextId: number): Promise<XMLNode> {
        return this._enqueueCommand('context_get', `-d ${stackDepth} -c ${contextId}`);
    }

    /** Sends a property_value command */
    public getProperty(stackDepth: number, contextId: number, longPropertyName: string): Promise<XMLNode> {
        return this._enqueueCommand('property_get', `-d ${stackDepth} -c ${contextId} -n ${longPropertyName}`);
    }
}
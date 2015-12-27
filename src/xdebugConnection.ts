
import * as net from 'net';
import {EventEmitter} from 'events';
import {Thread} from 'vscode-debugadapter';
import * as iconv from 'iconv-lite';
import {DOMParser} from 'xmldom';

const ENCODING = 'iso-8859-1';

export interface InitResponse {
    fileUri: string;
    protocolVersion: string;
    language: string;
    ideKey: string;
}

interface Command {
    name: string;
    args?: string;
    data?: string;
    resolveFn: (response: Document) => any;
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
    private _initPromise: Promise<InitResponse>;

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
        this._initPromise = new Promise<InitResponse>((resolve, reject) => {
            this._pendingCommand = {
                name: null,
                rejectFn: reject,
                resolveFn: (document: Document) => {
                    const documentElement = document.documentElement;
                    resolve({
                        fileUri: documentElement.getAttribute('fileuri'),
                        language: documentElement.getAttribute('language'),
                        protocolVersion: documentElement.getAttribute('protocolversion'),
                        ideKey: documentElement.getAttribute('idekey')
                    });
                }
            };
        });
        console.log('New XDebug Connection #' + this._id);
    }

    public waitForInitPacket(): Promise<Document> {
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
        const command = this._pendingCommand;
        if (!command) {
            console.error('XDebug sent a response, but there was no pending command');
            return;
        }
        this._pendingCommand = null;
        try {
            const firstNullByte = data.indexOf(0);
            const secondNullByte = data.indexOf(0, firstNullByte + 1);
            if (firstNullByte === -1 || secondNullByte === -1) {
                throw new InvalidMessageError(data);
            }
            const dataLength = parseInt(iconv.decode(data.slice(0, firstNullByte), ENCODING));
            const xml = iconv.decode(data.slice(firstNullByte + 1, secondNullByte), ENCODING);
            const parser = new DOMParser();
            const document = parser.parseFromString(xml, 'application/xml');
            command.resolveFn(document);
            //console.log('#' + this._connectionId + ' received packet from XDebug, packet length ' + dataLength, result);
            //const transactionId = parseInt(result.attributes['transaction_id']);
        } catch (err) {
            command.rejectFn(err);
        } finally {
            if (this._queue.length > 0) {
                const command = this._queue.shift();
                this._executeCommand(command);
            }
        }
    }

    /**
     * Pushes a new command to the queue that will be executed after all the previous commands have finished and we received a response.
     * If the queue is empty AND there are no pending transactions (meaning we already received a response and XDebug is waiting for
     * commands) the command will be executed emidiatly.
     */
    private _enqueueCommand(name: string, args?: string, data?: string): Promise<XMLNode> {
        return new Promise((resolveFn, rejectFn) => {
            const command = {name, args, data, resolveFn, rejectFn};
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
        if (command.data) {
            commandString += ' -- ' + (new Buffer(command.data, 'utf8')).toString('base64');
        }
        commandString += '\0';
        const data = iconv.encode(commandString, ENCODING);
        this._socket.write(data);
        this._pendingCommand = command;
    }

    public close(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this._socket.once('close', resolve);
            this._socket.end();
        });
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

    public listBreakpoints(): Promise<XMLNode> {
        return this._enqueueCommand('breakpoint_list');
    }

    public removeBreakpoint(breakpointId: number): Promise<XMLNode> {
        return this._enqueueCommand('breakpoint_remove', `-d ${breakpointId}`);
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
        return this._enqueueCommand('stop');
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

    // ------------------------------- eval -----------------------------------------

    public eval(expression: string): Promise<XMLNode> {
        return this._enqueueCommand('eval', null, expression);
    }
}
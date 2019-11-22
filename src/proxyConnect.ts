import { Socket } from 'net'
import { DOMParser } from 'xmldom'
import { EventEmitter } from 'events'
import { decode } from 'iconv-lite'
import { ENCODING } from './xdebugConnection'

export const DEFAULTIDEKEY = 'vsc'
export interface ProxyMessages {
    defaultError: string
    deregisterInfo: string
    deregisterSuccess: string
    duplicateKey: string
    nonexistentKey: string
    registerInfo: string
    registerSuccess: string
    resolve: string
    timeout: string
    raceCall: string
}

/** Informs proxy of incoming connection and who to pass data back to. */
export class ProxyConnect extends EventEmitter {
    /** Port editor is listening on (default: 9001 */
    private _port: number
    /** a CLI binary boolean option (default: 1) */
    private _allowMultipleSessions: number
    /** host domain or ip (default: 127.0.0.1) */
    private _host: string
    /** ide port proxy will connect back */
    private _ideport: number
    /** unique key that allows the proxy to match requests to your editor. (default: DEFAULTIDEKEY) */
    private _key: string
    /** proxy response data parser */
    private _parser = new DOMParser()
    /** tcp connection to communicate with proxy server */
    private _socket: Socket
    /** milliseconds to wait before giving up */
    private _timeout: number
    public msgs: ProxyMessages
    private _isRegistered = false
    private _resolveFn: (() => any) | null
    private _rejectFn: ((error?: Error) => any) | null
    private _chunksDataLength: number
    private _chunks: Buffer[]

    constructor(
        host = '127.0.0.1',
        port = 9001,
        ideport = 9000,
        allowMultipleSessions = true,
        key = DEFAULTIDEKEY,
        timeout = 3000,
        socket?: Socket
    ) {
        super()
        this._allowMultipleSessions = allowMultipleSessions ? 1 : 0
        this._host = host
        this._key = key
        this._port = port
        this._ideport = ideport
        this._timeout = timeout
        this._socket = !!socket ? socket : new Socket()
        this._chunksDataLength = 0
        this._chunks = []
        this._resolveFn = null
        this._rejectFn = null
        this.msgs = {
            defaultError: 'Unknown proxy Error',
            deregisterInfo: `Deregistering ${this._key} with proxy @ ${this._host}:${this._port}`,
            deregisterSuccess: 'Deregistration successful',
            duplicateKey: 'IDE Key already exists',
            nonexistentKey: 'No IDE key',
            registerInfo: `Registering ${this._key} on port ${this._ideport} with proxy @ ${this._host}:${this._port}`,
            registerSuccess: 'Registration successful',
            resolve: `Failure to resolve ${this._host}`,
            timeout: `Timeout connecting to ${this._host}:${this._port}`,
            raceCall: 'New command before old finished',
        }
        this._socket.on('error', (err: Error) => {
            // Propagate error up
            this._socket.end()
            this.emit('log_error', err instanceof Error ? err : new Error(err))
            if (this._rejectFn != null) {
                this._rejectFn(err instanceof Error ? err : new Error(err))
                this._resolveFn = this._rejectFn = null
            }
        })
        this._socket.on('lookup', (err: Error | null, address: string, family: string | null, host: string) => {
            if (err instanceof Error) {
                this._socket.emit('error', this.msgs.resolve)
            }
        })
        this._socket.on('data', data => {
            this._chunks.push(data)
            this._chunksDataLength += data.length
        })
        this._socket.on('close', had_error => {
            if (!had_error) {
                this._responseStrategy(Buffer.concat(this._chunks, this._chunksDataLength))
            }
            this._chunksDataLength = 0
            this._chunks = []
        })
        this._socket.setTimeout(this._timeout)
        this._socket.on('timeout', () => {
            this._socket.emit('error', this.msgs.timeout)
        })
    }

    private _command(cmd: string, msg?: string) {
        this.emit('log_request', msg)
        this._socket.connect(
            this._port,
            this._host,
            () => this._socket.end(cmd)
        )
    }

    /** Register/Couples ideKey to IP so the proxy knows who to send what */
    public sendProxyInitCommand(): Promise<void> {
        if (this._rejectFn != null) {
            this._rejectFn(new Error(this.msgs.raceCall))
            this._resolveFn = this._rejectFn = null
        }
        return new Promise((resolveFn, rejectFn) => {
            if (!this._isRegistered) {
                this._resolveFn = resolveFn
                this._rejectFn = rejectFn
                this._command(
                    `proxyinit -k ${this._key} -p ${this._ideport} -m ${this._allowMultipleSessions}`,
                    this.msgs.registerInfo
                )
            } else {
                this._resolveFn = this._rejectFn = null
                resolveFn()
            }
        })
    }

    /** Deregisters/Decouples ideKey from IP, allowing others to use the ideKey */
    public sendProxyStopCommand(): Promise<void> {
        if (this._rejectFn != null) {
            this._rejectFn(new Error(this.msgs.raceCall))
            this._resolveFn = this._rejectFn = null
        }
        return new Promise((resolveFn, rejectFn) => {
            if (this._isRegistered) {
                this._resolveFn = resolveFn
                this._rejectFn = rejectFn
                this._command(`proxystop -k ${this._key}`, this.msgs.deregisterInfo)
            } else {
                this._resolveFn = this._rejectFn = null
                resolveFn()
            }
        })
    }

    /** Parse data from response server and emit the relevant notification. */
    private _responseStrategy(data: Buffer) {
        const documentElement = this._parser.parseFromString(decode(data, ENCODING), 'application/xml').documentElement
        const isSuccessful = documentElement.getAttribute('success') === '1'
        const error = documentElement.firstChild
        if (isSuccessful && documentElement.nodeName === 'proxyinit') {
            this._isRegistered = true
            this.emit('log_response', this.msgs.registerSuccess)
            if (this._resolveFn != null) {
                this._resolveFn()
            }
            this._resolveFn = this._rejectFn = null
        } else if (isSuccessful && documentElement.nodeName === 'proxystop') {
            this._isRegistered = false
            this.emit('log_response', this.msgs.deregisterSuccess)
            if (this._resolveFn != null) {
                this._resolveFn()
            }
            this._resolveFn = this._rejectFn = null
        } else if (error && error.nodeName === 'error' && error.firstChild && error.firstChild.textContent) {
            this._socket.emit('error', error.firstChild.textContent)
            if (this._rejectFn != null) {
                this._rejectFn(new Error(error.firstChild.textContent))
            }
            this._resolveFn = this._rejectFn = null
        } else {
            this._socket.emit('error', this.msgs.defaultError)
            if (this._rejectFn != null) {
                this._rejectFn(new Error(this.msgs.defaultError))
            }
            this._resolveFn = this._rejectFn = null
        }
    }
}

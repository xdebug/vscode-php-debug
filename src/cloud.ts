import * as crc32 from 'buffer-crc32'
import * as net from 'net'
import { Transport, DbgpConnection, ENCODING } from './dbgp'
import * as tls from 'tls'
import * as iconv from 'iconv-lite'
import * as xdebug from './xdebugConnection'
import { EventEmitter } from 'stream'

export declare interface XdebugCloudConnection {
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'close', listener: () => void): this
    on(event: 'log', listener: (text: string) => void): this
    on(event: 'connection', listener: (conn: xdebug.Connection) => void): this
}

export class XdebugCloudConnection extends EventEmitter {
    private _token: string

    private _netSocket: net.Socket
    private _tlsSocket: net.Socket

    private _resolveFn: (() => void) | null
    private _rejectFn: ((error?: Error) => void) | null

    private _dbgpConnection: DbgpConnection

    private _logging = true

    constructor(token: string, testSocket?: net.Socket) {
        super()
        if (testSocket != null) {
            this._netSocket = testSocket
            this._tlsSocket = testSocket
        } else {
            this._netSocket = new net.Socket()
            this._tlsSocket = new tls.TLSSocket(this._netSocket)
        }
        this._token = token
        this._resolveFn = null
        this._rejectFn = null
        this._dbgpConnection = new DbgpConnection(this._tlsSocket)

        this._dbgpConnection.on('log', (text: string) => {
            if (this._logging) {
                this.emit('log', text)
            }
        })

        this._dbgpConnection.on('message', (response: XMLDocument) => {
            if (response.documentElement.nodeName === 'cloudinit') {
                if (response.documentElement.firstChild && response.documentElement.firstChild.nodeName === 'error') {
                    this._rejectFn?.(
                        new Error(`Error in CloudInit ${response.documentElement.firstChild.textContent ?? ''}`)
                    )
                } else {
                    this._resolveFn?.()
                }
            } else if (response.documentElement.nodeName === 'cloudstop') {
                if (response.documentElement.firstChild && response.documentElement.firstChild.nodeName === 'error') {
                    this._rejectFn?.(
                        new Error(`Error in CloudStop ${response.documentElement.firstChild.textContent ?? ''}`)
                    )
                } else {
                    this._resolveFn?.()
                }
            } else if (response.documentElement.nodeName === 'init') {
                this._logging = false
                // spawn a new xdebug.Connection
                const cx = new xdebug.Connection(new InnerCloudTransport(this._tlsSocket))
                cx.once('close', () => (this._logging = true))
                cx.emit('message', response)
                this.emit('connection', cx)
            }
        })

        this._dbgpConnection.on('error', (err: Error) => {
            this.emit('log', `dbgp error: ${err.toString()}`)
            this._rejectFn?.(err instanceof Error ? err : new Error(err))
        })
        /*
        this._netSocket.on('error', (err: Error) => {
            this.emit('log', `netSocket error ${err.toString()}`)
            this._rejectFn?.(err instanceof Error ? err : new Error(err))
        })
        */

        /*
        this._netSocket.on('connect', () => {
            this.emit('log', `netSocket connected`)
            //  this._resolveFn?.()
        })
        this._tlsSocket.on('secureConnect', () => {
            this.emit('log', `tlsSocket secureConnect`)
            //this._resolveFn?.()
        })
        */

        /*
        this._netSocket.on('close', had_error => {
            this.emit('log', 'netSocket close')
            this._rejectFn?.() // err instanceof Error ? err : new Error(err))
        })
        this._tlsSocket.on('close', had_error => {
            this.emit('log', 'tlsSocket close')
            this._rejectFn?.()
        })
        */
        this._dbgpConnection.on('close', () => {
            this.emit('log', `dbgp close`)
            this._rejectFn?.() // err instanceof Error ? err : new Error(err))
            this.emit('close')
        })
    }

    private computeCloudHost(token: string): string {
        const c = crc32.default(token)
        const last = c[3] & 0x0f
        const url = `${String.fromCharCode(97 + last)}.cloud.xdebug.com`

        return url
    }

    public async connect(): Promise<void> {
        await new Promise<void>((resolveFn, rejectFn) => {
            this._resolveFn = resolveFn
            this._rejectFn = rejectFn

            this._netSocket
                .connect(
                    {
                        host: this.computeCloudHost(this._token),
                        servername: this.computeCloudHost(this._token),
                        port: 9021,
                    } as net.SocketConnectOpts,
                    resolveFn
                )
                .on('error', rejectFn)
        })

        const commandString = `cloudinit -i 1 -u ${this._token}\0`
        const data = iconv.encode(commandString, ENCODING)

        const p2 = new Promise<void>((resolveFn, rejectFn) => {
            this._resolveFn = resolveFn
            this._rejectFn = rejectFn
        })

        await this._dbgpConnection.write(data)

        await p2
    }

    public async stop(): Promise<void> {
        if (!this._tlsSocket.writable) {
            return Promise.resolve()
        }

        const commandString = `cloudstop -i 2 -u ${this._token}\0`
        const data = iconv.encode(commandString, ENCODING)

        const p2 = new Promise<void>((resolveFn, rejectFn) => {
            this._resolveFn = resolveFn
            this._rejectFn = rejectFn
        })

        await this._dbgpConnection.write(data)
        return p2
    }

    public async close(): Promise<void> {
        return new Promise<void>(resolve => {
            this._tlsSocket.end(resolve)
        })
    }

    public async connectAndStop(): Promise<void> {
        await new Promise<void>((resolveFn, rejectFn) => {
            // this._resolveFn = resolveFn
            this._rejectFn = rejectFn
            this._netSocket
                .connect(
                    {
                        host: this.computeCloudHost(this._token),
                        servername: this.computeCloudHost(this._token),
                        port: 9021,
                    } as net.SocketConnectOpts,
                    resolveFn
                )
                .on('error', rejectFn)
        })
        await this.stop()
        await this.close()
    }
}

class InnerCloudTransport extends EventEmitter implements Transport {
    private _open = true

    constructor(private _socket: net.Socket) {
        super()

        this._socket.on('data', (data: Buffer) => {
            if (this._open) this.emit('data', data)
        })
        this._socket.on('error', (error: Error) => {
            if (this._open) this.emit('error', error)
        })
        this._socket.on('close', () => {
            if (this._open) this.emit('close')
        })
    }

    public get writable(): boolean {
        return this._open && this._socket.writable
    }

    write(buffer: string | Uint8Array, cb?: ((err?: Error | undefined) => void) | undefined): boolean {
        return this._socket.write(buffer, cb)
    }

    end(callback?: (() => void) | undefined): this {
        if (this._open) {
            this._open = false
            this.emit('close')
        }
        return this
    }

    destroy(error?: Error): this {
        if (this._open) {
            this._open = false
            this.emit('close')
        }
        return this
    }
}

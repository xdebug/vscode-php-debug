import * as crc32 from 'buffer-crc32'
import * as net from 'net'
import { Transport, DbgpConnection, ENCODING } from './dbgp'
import * as tls from 'tls'
import * as iconv from 'iconv-lite'
import * as xdebug from './xdebugConnection'
import { EventEmitter } from 'stream'

export declare interface XdebugCloudConnection extends DbgpConnection {
    on(event: 'message', listener: (document: Document) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'close', listener: () => void): this
    on(event: 'warning', listener: (warning: string) => void): this
    on(event: 'log', listener: (text: string) => void): this
    on(event: 'connection', listener: (notify: xdebug.Connection) => void): this
}

export class XdebugCloudConnection extends DbgpConnection {
    private _token: string
    //private _timeout: number

    private _netSocket: net.Socket
    private _tlsSocket: tls.TLSSocket

    private _resolveFn: (() => void) | null
    private _rejectFn: ((error?: Error) => void) | null

    // private dbgpConnection: DbgpConnection

    constructor(token: string, timeout = 3000) {
        const _netSocket = new net.Socket()
        const _tlsSocket = new tls.TLSSocket(_netSocket)
        super(_tlsSocket)
        this._token = token
        //this._timeout = timeout
        this._netSocket = _netSocket // new net.Socket()
        this._tlsSocket = _tlsSocket // new tls.TLSSocket(this._socket)
        this._resolveFn = null
        this._rejectFn = null

        this.on('message', (response: XMLDocument) => {
            if (response.documentElement.nodeName === 'cloudinit') {
                // omg
                this.emit('log', `YEAH BABY ${response.documentElement}`)
                if (response.documentElement.firstChild && response.documentElement.firstChild.nodeName === 'error') {
                    this._rejectFn?.(new Error(`Error in CloudInit ${response.documentElement.firstChild.textContent}`))
                } else {
                    this._resolveFn?.()
                }
                // TODO
            } else if (response.documentElement.nodeName === 'cloudstop') {
                if (response.documentElement.firstChild && response.documentElement.firstChild.nodeName === 'error') {
                    //this._resolveFn?.()
                    this._rejectFn?.(new Error(`Error in CloudStop ${response.documentElement.firstChild.textContent}`))
                } else {
                    this._resolveFn?.()
                }
            } else if (response.documentElement.nodeName === 'init') {
                // spawn a new xdebug.Connection
                const cx = new xdebug.Connection(new InnerCloudTransport(this._tlsSocket))
                cx.emit('message', response)
                this.emit('connection', cx)
            }
        })

        this.on('error', (err: Error) => {
            this.emit('log', `error from parent ${err}`)
            this._rejectFn?.(err instanceof Error ? err : new Error(err))
        })

        this._netSocket.on('connect', () => {
            this.emit('log', `connected`)
            //  this._resolveFn?.()
        })
        this._tlsSocket.on('secureConnect', () => {
            this.emit('log', `secureConnect`)
            //this._resolveFn?.()
        })
        this._netSocket.on('close', had_error => {
            this.emit('log', `close`)
            this._rejectFn?.() // err instanceof Error ? err : new Error(err))
        })
        this.on('close', () => {
            this.emit('log', `close from parent`)
            this._rejectFn?.() // err instanceof Error ? err : new Error(err))
        })
        this._netSocket.on('error', (err: Error) => {
            this.emit('log', `net socket error ${err}`)
            this._rejectFn?.(err instanceof Error ? err : new Error(err))
        })

        this._tlsSocket.on('data', (data: Buffer) => {
            // this.emit('log', `tlsraw ${data.toString()}`);
        })
        //this._socket.setTimeout(this._timeout)
        //this._socket.on('timeout', () => {
        //    this._socket.emit('error', 'xc timeout')
        //})

        //this._initPromiseRejectFn(new Error('connection closed (on close)')))

        //socket.on('data', (data: Buffer) => this._handleDataChunk(data))
        //socket.on('error', (error: Error) => this.emit('error', error))
        //socket.on('close', () => this.emit('close'))
        /*
this._socket.on('error', (err: Error) => {
    // Propagate error up
    this._socket.end()
    this.emit('log_error', err instanceof Error ? err : new Error(err))
    this._rejectFn?.(err instanceof Error ? err : new Error(err))
})

this._socket.on('lookup', (err: Error | null, address: string, family: string | null, host: string) => {
    if (err instanceof Error) {
        this._socket.emit('error', `Resolve error ${err}`)
    }
})

*/
    }

    private computeCloudHost(token: string): string {
        let c = crc32.default(token)
        let last = c[3] & 0x0f
        let url = `${String.fromCharCode(97 + last)}.cloud.xdebug.com`

        return url
    }

    public async connect(): Promise<net.Socket> {
        await new Promise<void>((resolveFn, rejectFn) => {
            this._resolveFn = resolveFn
            this._rejectFn = rejectFn

            this._netSocket.connect(
                {
                    host: this.computeCloudHost(this._token),
                    port: 9021,
                },
                resolveFn
            )
        })

        const commandString = `cloudinit -i 1 -u ${this._token}\0`
        const data = iconv.encode(commandString, ENCODING)

        const p2 = new Promise<void>((resolveFn, rejectFn) => {
            this._resolveFn = resolveFn
            this._rejectFn = rejectFn
        })

        await this.write(data)

        await p2

        // setTimeout(() => {
         //    this.stop()
        // }, 1000)

        return this._tlsSocket
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

        await this.write(data)
        return p2
    }

    public async close(): Promise<void> {
        await this.stop()
        return new Promise<void>(resolve => {
            this._netSocket.end(resolve)
        })
    }

    public async connectAndStop(): Promise<void> {
        await new Promise<void>((resolveFn, rejectFn) => {
            this._netSocket.connect(
                {
                    host: this.computeCloudHost(this._token),
                    port: 9021,
                },
                resolveFn
            )
            .on('error', rejectFn)
        })
        await this.close();
    }
}


class InnerCloudTransport extends EventEmitter implements Transport {

    private _open: boolean = true

    constructor(
        private _socket: tls.TLSSocket) {
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
        // ignore close ... or maybe send detatch? add delay??
        if (this._open) {
            this._open = false
            this.emit('close')
        }
        return this
    }

}
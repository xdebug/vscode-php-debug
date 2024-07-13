import { EventEmitter } from 'events'
import * as iconv from 'iconv-lite'
import { DOMParser } from '@xmldom/xmldom'

/** The encoding all Xdebug messages are encoded with */
export const ENCODING = 'utf-8'

/** The two states the connection switches between */
enum ParsingState {
    DataLength,
    Response,
}

export interface Transport {
    readonly writable: boolean
    on(event: 'data', listener: (data: Buffer) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'close', listener: () => void): this
    write(buffer: Uint8Array | string, cb?: (err?: Error) => void): boolean
    end(callback?: () => void): this
    destroy(error?: Error): this
}

export declare interface DbgpConnection {
    on(event: 'message', listener: (document: Document) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'close', listener: () => void): this
    on(event: 'warning', listener: (warning: string) => void): this
    on(event: 'log', listener: (text: string) => void): this
}

/** Wraps the NodeJS Socket and calls handleResponse() whenever a full response arrives */
export class DbgpConnection extends EventEmitter {
    private _socket: Transport
    private _parsingState: ParsingState
    private _chunksDataLength: number
    private _chunks: Buffer[]
    private _dataLength: number
    private _closePromise: Promise<void>
    private _closePromiseResolveFn: () => void

    constructor(socket: Transport) {
        super()
        this._socket = socket
        this._parsingState = ParsingState.DataLength
        this._chunksDataLength = 0
        this._chunks = []
        this._closePromise = new Promise<void>(resolve => (this._closePromiseResolveFn = resolve))
        socket.on('data', (data: Buffer) => this._handleDataChunk(data))
        socket.on('error', (error: Error) => this.emit('error', error))
        socket.on('close', () => {
            this._closePromiseResolveFn?.()
            this.emit('close')
        })
    }

    private _handleDataChunk(data: Buffer): void {
        // Anatomy of packets: [data length] [NULL] [xml] [NULL]
        // are we waiting for the data length or for the response?
        if (this._parsingState === ParsingState.DataLength) {
            // does data contain a NULL byte?
            const nullByteIndex = data.indexOf(0)
            if (nullByteIndex !== -1) {
                // YES -> we received the data length and are ready to receive the response
                const lastPiece = data.slice(0, nullByteIndex)
                this._chunks.push(lastPiece)
                this._chunksDataLength += lastPiece.length
                this._dataLength = parseInt(
                    iconv.decode(Buffer.concat(this._chunks, this._chunksDataLength), ENCODING),
                    10
                )
                // reset buffered chunks
                this._chunks = []
                this._chunksDataLength = 0
                // switch to response parsing state
                this._parsingState = ParsingState.Response
                // if data contains more info (except the NULL byte)
                if (data.length > nullByteIndex + 1) {
                    // handle the rest of the packet as part of the response
                    const rest = data.slice(nullByteIndex + 1)
                    this._handleDataChunk(rest)
                }
            } else {
                // NO -> this is only part of the data length. We wait for the next data event
                this._chunks.push(data)
                this._chunksDataLength += data.length
            }
        } else if (this._parsingState === ParsingState.Response) {
            // does the new data together with the buffered data add up to the data length?
            if (this._chunksDataLength + data.length >= this._dataLength) {
                // YES -> we received the whole response
                // append the last piece of the response
                const lastResponsePiece = data.slice(0, this._dataLength - this._chunksDataLength)
                this._chunks.push(lastResponsePiece)
                this._chunksDataLength += data.length
                const response = Buffer.concat(this._chunks, this._chunksDataLength)
                // call response handler
                const xml = iconv.decode(response, ENCODING)
                const parser = new DOMParser({
                    errorHandler: {
                        warning: warning => {
                            this.emit('warning', warning)
                        },
                        error: error => {
                            this.emit('error', error instanceof Error ? error : new Error(error as string))
                        },
                        fatalError: error => {
                            this.emit('error', error instanceof Error ? error : new Error(error as string))
                        },
                    },
                })
                this.emit('log', `-> ${xml.replace(/[\0\n]/g, '')}`)
                const document = parser.parseFromString(xml, 'application/xml')
                this.emit('message', document)
                // reset buffer
                this._chunks = []
                this._chunksDataLength = 0
                // switch to data length parsing state
                this._parsingState = ParsingState.DataLength
                // if data contains more info (except the NULL byte)
                if (data.length > lastResponsePiece.length + 1) {
                    // handle the rest of the packet (after the NULL byte) as data length
                    const rest = data.slice(lastResponsePiece.length + 1)
                    this._handleDataChunk(rest)
                }
            } else {
                // NO -> this is not the whole response yet. We buffer it and wait for the next data event.
                this._chunks.push(data)
                this._chunksDataLength += data.length
            }
        }
    }

    public write(command: Buffer): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this._socket.writable) {
                this.emit('log', `<- ${command.toString().replace(/[\0\n]/g, '')}`)
                this._socket.write(command, () => {
                    resolve()
                })
            } else {
                reject(new Error('socket not writable'))
            }
        })
    }

    /** closes the underlying socket */
    public close(): Promise<void> {
        this._socket.destroy()
        return this._closePromise
    }
}

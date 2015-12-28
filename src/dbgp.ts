
import * as net from 'net';
import {EventEmitter} from 'events';
import * as iconv from 'iconv-lite';
import {DOMParser} from 'xmldom';

/** The encoding all XDebug messages are encoded with */
const ENCODING = 'iso-8859-1';

function parseResponse(response: Buffer): XMLDocument {
    const xml = iconv.decode(response, ENCODING);
    const parser = new DOMParser();
    const document = parser.parseFromString(xml, 'application/xml');
    return document;
}

/** The two states the connection switches between */
enum ParsingState {DataLength, Response};

/** Wraps the NodeJS Socket and calls handleResponse() whenever a full response arrives */
export abstract class DbgpConnection {

    private _socket: net.Socket;
    private _parsingState: ParsingState;
    private _dataLengthBuffer: Buffer;
    private _responseBuffer: Buffer;
    private _dataLength: number;

    constructor(socket: net.Socket) {
        this._socket = socket;
        this._parsingState = ParsingState.DataLength;
        this._dataLengthBuffer = new Buffer(0);
        this._responseBuffer = new Buffer(0);
        // Anatomy of packets: [data length] [NULL] [xml] [NULL]
        const handleDataChunk = (data: Buffer) => {
            // are we waiting for the data length or for the response?
            if (this._parsingState === ParsingState.DataLength) {
                // does data contain a NULL byte?
                const nullByteIndex = data.indexOf(0);
                if (nullByteIndex !== -1) {
                    // YES -> we received the data length and are ready to receive the response
                    this._dataLength = parseInt(iconv.decode(data.slice(0, nullByteIndex), ENCODING));
                    // reset buffer
                    this._dataLengthBuffer = new Buffer(0);
                    // switch to response parsing state
                    this._parsingState = ParsingState.Response;
                    // if data contains more info (except the NULL byte)
                    if (data.length > nullByteIndex + 1) {
                        // handle the rest of the packet as part of the response
                        const rest = data.slice(nullByteIndex + 1);
                        handleDataChunk(rest);
                    }
                } else {
                    // NO -> this is only part of the data length. We buffer it and wait for the next data event
                    this._dataLengthBuffer = Buffer.concat([this._dataLengthBuffer, data], this._dataLengthBuffer.length + data.length);
                }
            } else if (this._parsingState === ParsingState.Response) {
                // does the new data together with the buffered data add up to the data length?
                if (this._responseBuffer.length + data.length >= this._dataLength) {
                    // YES -> we received the whole response
                    const lastResponsePiece = data.slice(0, this._dataLength - this._responseBuffer.length);
                    // append the last piece of the response
                    const response = Buffer.concat([this._responseBuffer, lastResponsePiece], this._dataLength);
                    // call response handler
                    this.handleResponse(parseResponse(response));
                    // reset buffer
                    this._responseBuffer = new Buffer(0);
                    // switch to data length parsing state
                    this._parsingState = ParsingState.DataLength;
                    // if data contains more info (except the NULL byte)
                    if (data.length > lastResponsePiece.length + 1) {
                        // handle the rest of the packet (after the NULL byte) as data length
                        const rest = data.slice(lastResponsePiece.length + 1);
                        handleDataChunk(rest);
                    }
                } else {
                    // NO -> this is not the whole response yet. We buffer it and wait for the next data event.
                    this._responseBuffer = Buffer.concat([this._responseBuffer, data], this._responseBuffer.length + data.length);
                }
            }
        };
        socket.on('data', handleDataChunk);
    }

    protected abstract handleResponse(response: XMLDocument): void;

    public write(command: Buffer): void {
        this._socket.write(command);
    }

    /** closes the underlying socket */
    public close(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this._socket.once('close', resolve);
            this._socket.end();
        });
    }
}

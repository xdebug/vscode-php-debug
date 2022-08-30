import { DbgpConnection, ENCODING } from '../dbgp'
import { Socket } from 'net'
import * as iconv from 'iconv-lite'
import { assert } from 'chai'
import { describe, it, beforeEach } from 'mocha'

describe('DbgpConnection', () => {
    function makePacket(message: string): Buffer {
        const messageBuffer = iconv.encode(message, ENCODING)
        return Buffer.concat([Buffer.from(`${messageBuffer.length}\0`), messageBuffer, Buffer.from('\0')])
    }

    const message =
        '<?xml version="1.0" encoding="iso-8859-1"?>\n<init xmlns="urn:debugger_protocol_v1" xmlns:xdebug="http://xdebug.org/dbgp/xdebug">This is just a test</init>'
    const packet = makePacket(message)

    let socket: Socket
    let conn: DbgpConnection
    beforeEach(() => {
        socket = new Socket()
        conn = new DbgpConnection(socket)
    })

    it('should parse a response in one data event', done => {
        conn.on('message', (document: XMLDocument) => {
            assert.equal(document.documentElement.nodeName, 'init')
            assert.equal(document.documentElement.textContent, 'This is just a test')
            done()
        })
        conn.on('warning', done)
        conn.on('error', done)
        setTimeout(() => {
            socket.emit('data', packet)
        }, 100)
    })

    it('should parse a response over multiple data events', done => {
        conn.on('message', (document: XMLDocument) => {
            assert.equal(document.documentElement.nodeName, 'init')
            assert.equal(document.documentElement.textContent, 'This is just a test')
            done()
        })
        conn.on('warning', done)
        conn.on('error', done)
        const part1 = packet.slice(0, 50)
        const part2 = packet.slice(50, 100)
        const part3 = packet.slice(100)
        setTimeout(() => {
            socket.emit('data', part1)
            setTimeout(() => {
                socket.emit('data', part2)
                setTimeout(() => {
                    socket.emit('data', part3)
                }, 100)
            }, 100)
        }, 100)
    })

    it('should parse multiple responses in one data event', done => {
        conn.once('message', (document: XMLDocument) => {
            assert.equal(document.documentElement.nodeName, 'init')
            assert.equal(document.documentElement.textContent, 'This is just a test')
            conn.once('message', (document: XMLDocument) => {
                assert.equal(document.documentElement.nodeName, 'response')
                assert.equal(document.documentElement.textContent, 'This is just another test')
                done()
            })
        })
        conn.on('warning', done)
        conn.on('error', done)
        const packet2 = makePacket(
            '<?xml version="1.0" encoding="iso-8859-1"?>\n<response xmlns="urn:debugger_protocol_v1" xmlns:xdebug="http://xdebug.org/dbgp/xdebug">This is just another test</response>'
        )
        setTimeout(() => {
            socket.emit('data', packet)
            setTimeout(() => {
                socket.emit('data', packet2)
            })
        }, 100)
    })

    it('should error on invalid XML', () =>
        new Promise<void>((resolve, reject) => {
            conn.on('error', (error: Error) => {
                assert.isDefined(error)
                assert.instanceOf(error, Error)
                resolve()
            })
            conn.once('message', (document: XMLDocument) => {
                reject(new Error('emitted message event'))
            })
            socket.emit('data', makePacket('<</<<><>>><?><>'))
        }))
})

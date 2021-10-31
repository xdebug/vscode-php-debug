import { assert } from 'chai'
import { ProxyConnect, ProxyMessages } from '../proxyConnect'
import { encode } from 'iconv-lite'
import { ENCODING } from '../dbgp'
import { Socket } from 'net'

describe('ProxyConnect', () => {
    function _xml(cmd: string, success: number, msg = '', id = 0): Buffer {
        let err = `<proxy${cmd} success="${success}"><error id="${id}"><message>${msg}</message></error></proxy${cmd}>`
        return encode(`<?xml version="1.0" encoding="UTF-8"?>\n${err}`, ENCODING)
    }

    const host = 'host'
    const port = 9001
    let conn: ProxyConnect
    let testSocket: Socket
    let msgs: ProxyMessages

    beforeEach(() => {
        testSocket = new Socket()
        testSocket.connect = (...param: any[]): Socket => {
            return testSocket
        }
        conn = new ProxyConnect(host, port, 9000, true, undefined, 3000, testSocket)
        msgs = conn.msgs
    })

    it('should timeout', (done: Mocha.Done) => {
        assert.exists(conn)
        conn.sendProxyInitCommand().catch(err => {
            assert.equal(err.message, msgs.timeout)
            done()
        })
        testSocket.emit('error', new Error(msgs.timeout))
    })

    it('should fail if proxy is unreachable', (done: Mocha.Done) => {
        assert.exists(conn)
        conn.sendProxyInitCommand().catch(err => {
            assert.equal(err.message, msgs.resolve)
            done()
        })
        testSocket.emit('lookup', new Error(msgs.resolve))
    })

    it('should throw an error for duplicate IDE key', (done: Mocha.Done) => {
        assert.exists(conn)
        conn.sendProxyInitCommand().catch(err => {
            assert.equal(err.message, msgs.duplicateKey)
            done()
        })

        testSocket.emit('data', _xml('init', 0, msgs.duplicateKey))
        testSocket.emit('close', false)
    })

    it('should request registration', (done: Mocha.Done) => {
        conn.on('log_request', (str: string) => {
            assert.equal(str, msgs.registerInfo)
            done()
        })

        conn.sendProxyInitCommand()
    })

    it('should be registered', (done: Mocha.Done) => {
        conn.on('log_response', (str: string) => {
            assert.equal(str, msgs.registerSuccess)
            done()
        })

        conn.sendProxyInitCommand()
        testSocket.emit('data', _xml('init', 1))
        testSocket.emit('close', false)
    })

    it('should request deregistration', async (done: Mocha.Done) => {
        conn.on('log_request', (str: string) => {
            assert.equal(str, msgs.deregisterInfo)
            done()
        })
        testSocket.emit('data', _xml('init', 1))
        testSocket.emit('close', false)

        await conn.sendProxyStopCommand()
    })

    it('should be deregistered', async (done: Mocha.Done) => {
        conn.on('log_response', (str: string) => {
            assert.equal(str, msgs.deregisterSuccess)
            done()
        })
        testSocket.emit('data', _xml('stop', 1))
        testSocket.emit('close', false)
        await conn.sendProxyStopCommand()
    })

    it('should throw an error for nonexistent IDE key', (done: Mocha.Done) => {
        conn.sendProxyInitCommand()
        testSocket.emit('data', _xml('init', 1))
        testSocket.emit('close', false)

        conn.sendProxyStopCommand().catch(err => {
            assert.equal(msgs.nonexistentKey, err.message)
            done()
        })
        testSocket.emit('data', _xml('stop', 0, msgs.nonexistentKey))
        testSocket.emit('close', false)
    })
})

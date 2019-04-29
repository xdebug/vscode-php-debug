import { assert } from 'chai'
import { ProxyConnect, ProxyMessages } from '../proxyConnect'
import { encode } from 'iconv-lite'
import { ENCODING } from '../xdebugConnection'
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
        testSocket.connect = () => {
            return
        }
        conn = new ProxyConnect(host, port, true, undefined, 3000, testSocket)
        msgs = conn.msgs
    })

    it('should timeout', (done: MochaDone) => {
        conn.on('error', (err: Error) => {
            assert.equal(err.message, msgs.timeout)
            done()
        })
        assert.exists(conn)
        testSocket.emit('error', new Error(msgs.timeout))
    })

    it('should fail if proxy is unreachable', (done: MochaDone) => {
        conn.on('error', (err: Error) => {
            assert.equal(err.message, msgs.resolve)
            done()
        })

        testSocket.emit('lookup', new Error(msgs.resolve))
    })

    it('should throw an error for duplicate IDE key', (done: MochaDone) => {
        conn.on('error', (err: Error) => {
            assert.equal(msgs.duplicateKey, err.message)
            done()
        })

        testSocket.emit('data', _xml('init', 0, msgs.duplicateKey))
    })

    it('should request registration', (done: MochaDone) => {
        conn.on('info', (str: string) => {
            assert.equal(str, msgs.registerInfo)
            done()
        })

        conn.sendProxyInitCommand()
    })

    it('should be registered', (done: MochaDone) => {
        conn.on('response', (str: string) => {
            assert.equal(str, msgs.registerSuccess)
            done()
        })

        conn.sendProxyInitCommand()
        testSocket.emit('data', _xml('init', 1))
    })

    it('should request deregistration', async (done: MochaDone) => {
        conn.on('info', (str: string) => {
            assert.equal(str, msgs.deregisterInfo)
            done()
        })
        testSocket.emit('data', _xml('init', 1))

        await new Promise(resolve => conn.sendProxyStopCommand(resolve))
    })

    it('should be deregistered', (done: MochaDone) => {
        conn.on('response', (str: string) => {
            assert.equal(str, msgs.deregisterSuccess)
            done()
        })
        testSocket.emit('data', _xml('stop', 1))
    })

    it('should throw an error for nonexistent IDE key', (done: MochaDone) => {
        conn.on('error', (err: Error) => {
            assert.equal(msgs.nonexistentKey, err.message)
            done()
        })
        testSocket.emit('data', _xml('stop', 0, msgs.nonexistentKey))
    })
})

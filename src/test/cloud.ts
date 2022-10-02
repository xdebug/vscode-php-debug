import { XdebugCloudConnection } from '../cloud'
import { Socket } from 'net'
import { describe, it, beforeEach } from 'mocha'
import * as Mocha from 'mocha'
import { encode } from 'iconv-lite'
import { ENCODING } from '../dbgp'

describe('XdebugCloudConnection', () => {
    function _xml(cmd: string, success: number, msg = '', id = ''): Buffer {
        let err = `<cloud${cmd} success="${success}">`
        if (!success) {
            err += `<error id="${id}"><message>${msg}</message></error>`
        }
        err += `</cloud${cmd}>`
        const data = encode(`<?xml version="1.0" encoding="UTF-8"?>\n${err}`, ENCODING)
        return Buffer.concat([encode(data.length.toString() + '\0', ENCODING), data, encode('\0', ENCODING)])
    }

    // <cloudstop xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" success="1" userid="test"/>

    // <cloudinit xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" success="1" userid="test"><accountInfo name="User Name" uid="test" active="true" remaining="100" made="103"><name>user.name@xdebug.org</name></accountInfo></cloudinit>

    // <cloudinit xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" success="0" userid="" ><error id="CLOUD-ERR-03"><message>Cannot find account for &#39;test&#39;</message></error></cloudinit>

    let conn: XdebugCloudConnection
    let testSocket: Socket

    beforeEach(() => {
        testSocket = new Socket()
        testSocket.connect = (...param): Socket => {
            if (param[1] instanceof Function) {
                testSocket.once('connect', param[1] as () => void)
            }
            return testSocket
        }
        testSocket.write = (...param): boolean => {
            if (param[1] instanceof Function) {
                ;(param[1] as () => void)()
            }
            testSocket.emit('write', param[0])
            return true
        }
        testSocket.end = (...param): Socket => {
            if (param[0] instanceof Function) {
                ;(param[0] as () => void)()
            }
            return testSocket
        }
        conn = new XdebugCloudConnection('test', testSocket)
    })

    it('should connect and stop', (done: Mocha.Done) => {
        testSocket.on('write', (buffer: string | Buffer) => {
            testSocket.emit('data', _xml('stop', 1))
        })
        conn.connectAndStop().then(done, done)
        testSocket.emit('connect')
    })

    it('should connect', (done: Mocha.Done) => {
        testSocket.on('write', (buffer: string | Buffer) => {
            testSocket.emit('data', _xml('init', 1))
        })
        conn.connect().then(done, done)
        testSocket.emit('connect')
    })

    it('should connect and fail', (done: Mocha.Done) => {
        testSocket.on('write', (buffer: string | Buffer) => {
            testSocket.emit('data', _xml('init', 0, 'Cannot find account for test', 'CLOUD-ERR-03'))
        })
        conn.connect().then(
            () => done(Error('should not have succeeded ')),
            err => done()
        )
        testSocket.emit('connect')
    })
})

import { XdebugCloudConnection } from '../cloud'
import { Socket } from 'net'
import { describe, it, beforeEach } from 'mocha'
import * as Mocha from 'mocha'
import { encode } from 'iconv-lite'
import { ENCODING } from '../dbgp'

describe('XdebugCloudConnection', () => {
    function _xmlCloud(cmd: string, success: number, msg = '', id = ''): Buffer {
        let err = `<cloud${cmd} success="${success}">`
        if (!success) {
            err += `<error id="${id}"><message>${msg}</message></error>`
        }
        err += `</cloud${cmd}>`
        return _xml(err)
    }
    function _xml(xml: string): Buffer {
        const data = encode(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`, ENCODING)
        return Buffer.concat([encode(data.length.toString() + '\0', ENCODING), data, encode('\0', ENCODING)])
    }

    // <cloudstop xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" success="1" userid="test"/>

    // <cloudinit xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" success="1" userid="test"><accountInfo name="User Name" uid="test" active="true" remaining="100" made="103"><name>user.name@xdebug.org</name></accountInfo></cloudinit>

    // <cloudinit xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" success="0" userid="" ><error id="CLOUD-ERR-03"><message>Cannot find account for &#39;test&#39;</message></error></cloudinit>

    // <init xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" fileuri="file:///test.php" language="PHP" xdebug:language_version="8.1.2" protocol_version="1.0" xdebug:userid="test"><engine version="3.2.0-dev"><![CDATA[Xdebug]]></engine><author><![CDATA[Derick Rethans]]></author><url><![CDATA[https://xdebug.org]]></url><copyright><![CDATA[Copyright (c) 2002-2021 by Derick Rethans]]></copyright></init>

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
            setTimeout(() => {
                if (param[1] instanceof Function) {
                    ;(param[1] as () => void)()
                }
                testSocket.emit('write', param[0])
            }, 1)
            return true
        }
        testSocket.end = (...param): Socket => {
            setTimeout(() => {
                if (param[0] instanceof Function) {
                    ;(param[0] as () => void)()
                }
            }, 1)
            return testSocket
        }
        conn = new XdebugCloudConnection('test', testSocket)
    })

    it('should connect and stop', (done: Mocha.Done) => {
        testSocket.on('write', (buffer: string | Buffer) => {
            testSocket.emit('data', _xmlCloud('stop', 1))
        })
        conn.connectAndStop().then(done, done)
        testSocket.emit('connect')
    })

    it('should connect and stop and fail', (done: Mocha.Done) => {
        testSocket.on('write', (buffer: string | Buffer) => {
            testSocket.emit(
                'data',
                _xmlCloud('stop', 0, 'A client for test has not been previously registered', 'ERR-10')
            )
        })
        conn.connectAndStop().then(
            () => done(Error('should not have succeeded')),
            err => done()
        )
        testSocket.emit('connect')
    })

    it('should connect with error', (done: Mocha.Done) => {
        conn.connect().then(
            () => done(Error('should not have succeeded')),
            err => done()
        )
        testSocket.emit('error', new Error('connection error'))
    })

    it('should connect', (done: Mocha.Done) => {
        testSocket.on('write', (buffer: string | Buffer) => {
            testSocket.emit('data', _xmlCloud('init', 1))
        })
        conn.connect().then(done, done)
        testSocket.emit('connect')
    })

    it('should connect and fail', (done: Mocha.Done) => {
        testSocket.on('write', (buffer: string | Buffer) => {
            testSocket.emit('data', _xmlCloud('init', 0, 'Cannot find account for test', 'CLOUD-ERR-03'))
        })
        conn.connect().then(
            () => done(Error('should not have succeeded ')),
            err => done()
        )
        testSocket.emit('connect')
    })

    it('should connect and init', (done: Mocha.Done) => {
        testSocket.on('write', (buffer: string | Buffer) => {
            testSocket.emit('data', _xmlCloud('init', 1))
        })
        conn.connect().then(() => {
            // after connect, send init and wait for connection event
            testSocket.emit(
                'data',
                _xml(
                    '<init xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" fileuri="file:///test.php" language="PHP" xdebug:language_version="8.1.2" protocol_version="1.0" xdebug:userid="test"><engine version="3.2.0-dev"><![CDATA[Xdebug]]></engine><author><![CDATA[Derick Rethans]]></author><url><![CDATA[https://xdebug.org]]></url><copyright><![CDATA[Copyright (c) 2002-2021 by Derick Rethans]]></copyright></init>'
                )
            )
        }, done)
        conn.on('connection', conn => done())
        testSocket.emit('connect')
    })

    it('should connect and init and stop', (done: Mocha.Done) => {
        testSocket.once('write', (buffer: string | Buffer) => {
            testSocket.emit('data', _xmlCloud('init', 1))
        })
        conn.connect().then(() => {
            // after connect, send init and wait for connection event
            testSocket.emit(
                'data',
                _xml(
                    '<init xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" fileuri="file:///test.php" language="PHP" xdebug:language_version="8.1.2" protocol_version="1.0" xdebug:userid="test"><engine version="3.2.0-dev"><![CDATA[Xdebug]]></engine><author><![CDATA[Derick Rethans]]></author><url><![CDATA[https://xdebug.org]]></url><copyright><![CDATA[Copyright (c) 2002-2021 by Derick Rethans]]></copyright></init>'
                )
            )
        }, done)
        conn.on('connection', conn => {
            testSocket.once('write', (buffer: string | Buffer) => {
                testSocket.emit(
                    'data',
                    _xml(
                        '<response xmlns="urn:debugger_protocol_v1" xmlns:xdebug="https://xdebug.org/dbgp/xdebug" command="stop" transaction_id="1" status="stopped" reason="ok"/>'
                    )
                )
            })
            conn.sendStopCommand().then(() => done(), done)
        })
        testSocket.emit('connect')
    })
})

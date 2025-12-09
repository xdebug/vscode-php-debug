import { describe, it } from 'mocha'
import { ControlSocket } from '../controlSocket'
import { assert } from 'chai'

describe('ControlSocket', () => {
    ;(process.platform === 'darwin' ? it.skip : it)('should try to get list of sockets', async () => {
        const cs = new ControlSocket()
        const r = await cs.listControlSockets()
        assert.isArray(r)
    })
})

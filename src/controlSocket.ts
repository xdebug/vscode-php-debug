import * as xdebug from './xdebugConnection'
import * as semver from 'semver'
import * as net from 'net'

export class ControlSocket {
    /**
     * @returns Returns true if the current platoform is supported for Xdebug control socket (win and linux)
     */
    supportedPlatform(): boolean {
        return process.platform === 'linux' || process.platform === 'win32'
    }

    /**
     *
     * @param initPacket
     * @returns Returns true if the current platform and xdebug version are supporting Xdebug control socket.
     */
    supportedInitPacket(initPacket: xdebug.InitPacket): boolean {
        return (
            this.supportedPlatform() &&
            initPacket.engineName === 'Xdebug' &&
            semver.valid(initPacket.engineVersion, { loose: true }) !== null &&
            (semver.gte(initPacket.engineVersion, '3.5.0', { loose: true }) ||
                initPacket.engineVersion.startsWith('3.5.0'))
        )
    }

    /**
     *
     * @param ctrlSocket Control socket full path
     * @returns
     */
    async requestPause(ctrlSocket: string): Promise<void> {
        let retval
        if (process.platform === 'linux') {
            retval = await this.executeCtrlCmd(`\0${ctrlSocket}y`.padEnd(108, 'x'), 'pause')
        } else if (process.platform === 'win32') {
            retval = await this.executeCtrlCmd(ctrlSocket, 'pause')
        } else {
            throw new Error('Invalid platform for Xdebug control socket')
        }
        retval
        return
    }

    private async executeCtrlCmd(ctrlSocket: string, cmd: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const s = net.createConnection(ctrlSocket, () => {
                s.end(`${cmd}\0`)
            })
            s.setTimeout(3000)
            s.on('timeout', () => {
                reject(new Error('Timed out while reading from Xdebug control socket'))
                s.end()
            })
            s.on('data', data => {
                s.destroy()
                resolve(data.toString())
            })
            s.on('error', error => {
                reject(
                    new Error(
                        `Cannot connect to Xdebug control socket: ${String(
                            error instanceof Error ? error.message : error
                        )}`
                    )
                )
            })
            return
        })
    }
}

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
            (semver.gte(initPacket.engineVersion, '3.4.0', { loose: true }) || initPacket.engineVersion === '3.4.0-dev')
        )
    }

    /**
     *
     * @param pid appId returned in the init packet
     * @returns
     */
    async requestPause(pid: string): Promise<void> {
        let retval
        if (process.platform === 'linux') {
            retval = await this.executeLinux(pid, 'pause')
        } else if (process.platform === 'win32') {
            retval = await this.executeWindows(pid, 'pause')
        } else {
            throw new Error('Invalid platform for Xdebug control socket')
        }
        retval
        return
    }

    private async executeLinux(pid: string, cmd: string): Promise<string> {
        const abs = await import('abstract-socket')
        return new Promise<string>((resolve, reject) => {
            const cs = `\0xdebug-ctrl.${pid}y`.padEnd(108, 'x')
            try {
                const s = abs.connect(cs, () => {
                    s.write(`${cmd}\0`)
                })
                s.setTimeout(3000)
                s.on('timeout', () => {
                    reject(new Error('Timed out while reading from Xdebug control socket'))
                    s.end()
                })
                s.on('data', data => {
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
            } catch (error) {
                reject(
                    new Error(
                        `Cannot connect to Xdebug control socket: ${String(
                            error instanceof Error ? error.message : error
                        )}`
                    )
                )
                return
            }
        })
    }

    private async executeWindows(pid: string, cmd: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const s = net.createConnection(`\\\\.\\pipe\\xdebug-ctrl.${pid}`, () => {
                s.end(`${cmd}\0`)
            })
            s.setTimeout(3000)
            s.on('timeout', () => {
                reject(new Error('Timed out while reading from Xdebug control socket'))
                s.end()
            })
            s.on('data', data => {
                resolve(data.toString())
            })
            s.on('error', error => {
                // sadly this happens all the time - even on normal server-side-close, but luckily the promise is already resolved
                reject(
                    new Error(
                        `Cannot connect to Xdebug control socket: ${String(
                            error instanceof Error ? error.message : error
                        )}`
                    )
                )
            })
        })
    }
}

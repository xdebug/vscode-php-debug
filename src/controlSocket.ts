import * as xdebug from './xdebugConnection'
import * as net from 'net'
import * as CP from 'child_process'
import { promisify } from 'util'
import { supportedEngine } from './xdebugUtils'
import { DOMParser } from '@xmldom/xmldom'

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
        return this.supportedPlatform() && supportedEngine(initPacket, '3.5.0')
    }

    /**
     * Request the pause control socket command
     * @param ctrlSocket Control socket full path
     * @returns
     */
    async requestPause(ctrlSocket: string): Promise<void> {
        await this.executeCtrlCmd(ctrlSocket, 'pause')
    }

    async requestPS(ctrlSocket: string): Promise<ControlPS> {
        const xml = await this.executeCtrlCmd(ctrlSocket, 'ps')
        const parser = new DOMParser()
        const document = <unknown>parser.parseFromString(xml, 'application/xml')
        return new ControlPS(<XMLDocument>document)
    }

    private async executeCtrlCmd(ctrlSocket: string, cmd: string): Promise<string> {
        let rawCtrlSocket: string
        if (process.platform === 'linux') {
            rawCtrlSocket = `\0${ctrlSocket}`
        } else if (process.platform === 'win32') {
            rawCtrlSocket = `\\\\.\\pipe\\${ctrlSocket}`
        } else {
            throw new Error('Invalid platform for Xdebug control socket')
        }
        return new Promise<string>((resolve, reject) => {
            const s = net.createConnection(rawCtrlSocket, () => {
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

    async listControlSockets(): Promise<XdebugRunningProcess[]> {
        let retval:XdebugRunningProcess[]
        if (process.platform === 'linux') {
            // TODO
            throw new Error('Invalid platform for Xdebug control socket')
        } else if (process.platform === 'win32') {
            retval = await this.listControlSocketsWin()
        } else {
            throw new Error('Invalid platform for Xdebug control socket')
        }

        const retval2 = Promise.all(
            retval.map(async v => {
                try {
                    v.ps = await this.requestPS(v.ctrlSocket)
                } catch {
                    // ignore
                }
                return v
            })
        )
        return retval2
    }

    private async listControlSocketsWin(): Promise<XdebugRunningProcess[]> {
        const exec = promisify(CP.exec)
        try {
            const ret = await exec('cmd /C "dir \\\\.\\pipe\\\\xdebug-ctrl* /b"')
            const lines = ret.stdout.split('\r\n')

            const retval = lines
                .filter(v => v.length != 0)
                .map<XdebugRunningProcess>(v => <XdebugRunningProcess>{ ctrlSocket: v })

            return retval

        } catch (err) {
            if (err instanceof Error && (<ExecError>err).stderr == 'File Not Found\r\n') {
                return []
            }
            throw err
        }
    }
}

interface ExecError extends Error {
    stderr: string
}

export interface XdebugRunningProcess {
    readonly ctrlSocket: string
    ps: ControlPS
    // todo
}

export class ControlPS {
    /** The file that was requested as a file:// URI */
    fileUri: string
    /** the version of Xdebug */
    engineVersion: string
    /** the name of the engine */
    engineName: string
    /** the internal PID */
    pid: string
    /** memory consumption */
    memory: number
    /**
     * @param  {XMLDocument} document - An XML document to read from
     */
    constructor(document: XMLDocument) {
        const documentElement = <Element>document.documentElement.firstChild
        this.fileUri = documentElement.getElementsByTagName('fileuri').item(0)?.textContent ?? ''
        this.engineVersion = documentElement.getElementsByTagName('engine').item(0)?.getAttribute('version') ?? ''
        this.engineName = documentElement.getElementsByTagName('engine').item(0)?.textContent ?? ''
        this.pid = documentElement.getElementsByTagName('pid').item(0)?.textContent ?? ''
        this.memory = parseInt(documentElement.getElementsByTagName('memory').item(0)?.textContent ?? '0')
    }
}

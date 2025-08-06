import * as semver from 'semver'
import * as xdebug from './xdebugConnection'

export function supportedEngine(initPacket: xdebug.InitPacket, version: string): boolean {
    return (
        initPacket.engineName === 'Xdebug' &&
        semver.valid(initPacket.engineVersion.replace('-dev', ''), { loose: true }) !== null &&
        semver.gte(initPacket.engineVersion.replace('-dev', ''), version, { loose: true })
    )
}

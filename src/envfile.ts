import * as fs from 'fs'
import { LaunchRequestArguments } from './phpDebug'
import * as dotenv from 'dotenv'

/**
 * Returns the user-configured portion of the environment variables.
 */
export function getConfiguredEnvironment(args: LaunchRequestArguments): { [key: string]: string } {
    if (args.envFile) {
        try {
            return merge(readEnvFile(args.envFile), args.env || {})
        } catch (e) {
            throw new Error('Failed reading envFile')
        }
    }
    return args.env || {}
}

function readEnvFile(file: string): { [key: string]: string } {
    if (!fs.existsSync(file)) {
        return {}
    }
    const buffer = stripBOM(fs.readFileSync(file, 'utf8'))
    const env = dotenv.parse(Buffer.from(buffer))
    return env
}

function stripBOM(s: string): string {
    if (s && s[0] === '\uFEFF') {
        s = s.substring(1)
    }
    return s
}

function merge(...vars: { [key: string]: string }[]): { [key: string]: string } {
    if (process.platform === 'win32') {
        return caseInsensitiveMerge(...vars)
    }
    return Object.assign({}, ...vars) as { [key: string]: string }
}

/**
 * Performs a case-insenstive merge of the list of objects.
 */
function caseInsensitiveMerge<V>(...objs: ReadonlyArray<Readonly<{ [key: string]: V }> | undefined | null>) {
    if (objs.length === 0) {
        return {}
    }
    const out: { [key: string]: V } = {}
    const caseMapping: { [key: string]: string } = Object.create(null) // prototype-free object
    for (const obj of objs) {
        if (!obj) {
            continue
        }
        for (const key of Object.keys(obj)) {
            const normalized = key.toLowerCase()
            if (caseMapping[normalized]) {
                out[caseMapping[normalized]] = obj[key]
            } else {
                caseMapping[normalized] = key
                out[key] = obj[key]
            }
        }
    }
    return out
}

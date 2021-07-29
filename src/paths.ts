import fileUrl = require('file-url')
import * as url from 'url'
import * as path from 'path'
import { decode } from 'urlencode'
import RelateUrl from 'relateurl'

/**
 * Options to make sure that RelateUrl only outputs relative URLs and performs not other "smart" modifications.
 * They would mess up things like prefix checking.
 */
const RELATE_URL_OPTIONS: RelateUrl.Options = {
    // Make sure RelateUrl does not prefer root-relative URLs if shorter
    output: RelateUrl.PATH_RELATIVE,
    // Make sure RelateUrl does not remove trailing slash if present
    removeRootTrailingSlash: false,
    // Make sure RelateUrl does not remove default ports
    defaultPorts: {},
}

/**
 * Like `path.relative()` but for URLs.
 * Inverse of `url.resolve()` or `new URL(relative, base)`.
 */
const relativeUrl = (from: string, to: string): string => RelateUrl.relate(from, to, RELATE_URL_OPTIONS)

/** converts a server-side Xdebug file URI to a local path for VS Code with respect to source root settings */
export function convertDebuggerPathToClient(
    fileUri: string | url.Url,
    pathMapping?: { [index: string]: string }
): string {
    let localSourceRoot: string | undefined
    let serverSourceRoot: string | undefined
    if (typeof fileUri === 'string') {
        fileUri = url.parse(fileUri)
    }
    // convert the file URI to a path
    let serverPath = decode(fileUri.pathname!)
    // strip the trailing slash from Windows paths (indicated by a drive letter with a colon)
    const serverIsWindows = /^\/[a-zA-Z]:\//.test(serverPath)
    if (serverIsWindows) {
        serverPath = serverPath.substr(1)
    }
    if (pathMapping) {
        for (const mappedServerPath of Object.keys(pathMapping)) {
            const mappedLocalSource = pathMapping[mappedServerPath]
            // normalize slashes for windows-to-unix
            const serverRelative = (serverIsWindows ? path.win32 : path.posix).relative(mappedServerPath, serverPath)
            if (serverRelative.indexOf('..') !== 0) {
                // If a matching mapping has previously been found, only update
                // it if the current server path is longer than the previous one
                // (longest prefix matching)
                if (!serverSourceRoot || mappedServerPath.length > serverSourceRoot.length) {
                    serverSourceRoot = mappedServerPath
                    localSourceRoot = mappedLocalSource
                }
            }
        }
    }
    let localPath: string
    if (serverSourceRoot && localSourceRoot) {
        const clientIsWindows =
            /^[a-zA-Z]:\\/.test(localSourceRoot) ||
            /^\\\\/.test(localSourceRoot) ||
            /^[a-zA-Z]:$/.test(localSourceRoot) ||
            /^[a-zA-Z]:\//.test(localSourceRoot)
        // get the part of the path that is relative to the source root
        let pathRelativeToSourceRoot = (serverIsWindows ? path.win32 : path.posix).relative(
            serverSourceRoot,
            serverPath
        )
        if (serverIsWindows && !clientIsWindows) {
            pathRelativeToSourceRoot = pathRelativeToSourceRoot.replace(/\\/g, path.posix.sep)
        }
        if (clientIsWindows && /^[a-zA-Z]:$/.test(localSourceRoot)) {
            // if local source root mapping is only drive letter, add backslash
            localSourceRoot += '\\'
        }
        // resolve from the local source root
        localPath = (clientIsWindows ? path.win32 : path.posix).resolve(localSourceRoot, pathRelativeToSourceRoot)
    } else {
        localPath = (serverIsWindows ? path.win32 : path.posix).normalize(serverPath)
    }
    return localPath
}

/** converts a local path from VS Code to a server-side Xdebug file URI with respect to source root settings */
export function convertClientPathToDebugger(localPath: string, pathMapping?: { [index: string]: string }): string {
    let localSourceRoot: string | undefined
    let serverSourceRoot: string | undefined
    // Xdebug always lowercases Windows drive letters in file URIs
    let localFileUri = fileUrl(
        localPath.replace(/^[A-Z]:\\/, match => match.toLowerCase()),
        { resolve: false }
    )
    let serverFileUri: string
    if (pathMapping) {
        for (const mappedServerPath of Object.keys(pathMapping)) {
            let mappedLocalSource = pathMapping[mappedServerPath]
            if (/^[a-zA-Z]:$/.test(mappedLocalSource)) {
                // if local source root mapping is only drive letter, add backslash
                mappedLocalSource += '\\'
            }
            const localRelative = path.relative(mappedLocalSource, localPath)
            if (localRelative.indexOf('..') !== 0) {
                // If a matching mapping has previously been found, only update
                // it if the current local path is longer than the previous one
                // (longest prefix matching)
                if (!localSourceRoot || mappedLocalSource.length > localSourceRoot.length) {
                    serverSourceRoot = mappedServerPath
                    localSourceRoot = mappedLocalSource
                }
            }
        }
    }
    if (localSourceRoot) {
        localSourceRoot = localSourceRoot.replace(/^[A-Z]:$/, match => match.toLowerCase())
        localSourceRoot = localSourceRoot.replace(/^[A-Z]:\\/, match => match.toLowerCase())
        localSourceRoot = localSourceRoot.replace(/^[A-Z]:\//, match => match.toLowerCase())
    }
    if (serverSourceRoot) {
        serverSourceRoot = serverSourceRoot.replace(/^[A-Z]:$/, match => match.toLowerCase())
        serverSourceRoot = serverSourceRoot.replace(/^[A-Z]:\\/, match => match.toLowerCase())
        serverSourceRoot = serverSourceRoot.replace(/^[A-Z]:\//, match => match.toLowerCase())
    }
    if (serverSourceRoot && localSourceRoot) {
        let localSourceRootUrl = fileUrl(localSourceRoot, { resolve: false })
        if (!localSourceRootUrl.endsWith('/')) {
            localSourceRootUrl += '/'
        }
        let serverSourceRootUrl = fileUrl(serverSourceRoot, { resolve: false })
        if (!serverSourceRootUrl.endsWith('/')) {
            serverSourceRootUrl += '/'
        }
        // get the part of the path that is relative to the source root
        const urlRelativeToSourceRoot = relativeUrl(localSourceRootUrl, localFileUri)
        // resolve from the server source root
        serverFileUri = url.resolve(serverSourceRootUrl, urlRelativeToSourceRoot)
    } else {
        serverFileUri = localFileUri
    }
    return serverFileUri
}

export function isWindowsUri(path: string): boolean {
    return /^file:\/\/\/[a-zA-Z]:\//.test(path)
}

export function isSameUri(clientUri: string, debuggerUri: string): boolean {
    if (isWindowsUri(clientUri) || isWindowsUri(debuggerUri)) {
        // compare case-insensitive on Windows
        return debuggerUri.toLowerCase() === clientUri.toLowerCase()
    } else {
        return debuggerUri === clientUri
    }
}

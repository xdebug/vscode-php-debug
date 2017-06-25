
import urlRelative = require('url-relative');
import fileUrl = require('file-url');
import * as url from 'url';
import * as path from 'path';
import {decode} from 'urlencode';

/** converts a server-side XDebug file URI to a local path for VS Code with respect to source root settings */
export function convertDebuggerPathToClient(fileUri: string|url.Url, localSourceRoot?: string, serverSourceRoot?: string, pathMapping?: { [index: string]: string; }): string {

    if (typeof fileUri === 'string') {
        fileUri = url.parse(fileUri);
    }

    // convert the file URI to a path
    let serverPath = decode(fileUri.pathname!);

    // strip the trailing slash from Windows paths (indicated by a drive letter with a colon)
    const serverIsWindows = /^\/[a-zA-Z]:\//.test(serverPath);

    if (serverIsWindows) {
        serverPath = serverPath.substr(1);
    }

    if ( typeof pathMapping !== 'undefined' && pathMapping !== {} ) {
        let mappedServerSource: string;

        for (mappedServerSource of Object.keys(pathMapping) ) {
            let mappedLocalSource: string = pathMapping[mappedServerSource];

            // normalize slashes for windows-to-unix
            // I thought normalize did this automagically..
            if ( process.platform !== 'win32' ) {
                mappedServerSource = mappedServerSource.replace(/\\/g, '/');
            }

            let serverRelative: string = path.relative(mappedServerSource, serverPath);

            if ( serverRelative && serverRelative.length > 0 ) {
                let relative: number = serverRelative.indexOf('..');

                // if path does not start with ..
                if ( relative !== 0 ) {
                    serverSourceRoot = mappedServerSource;
                    localSourceRoot = mappedLocalSource;

                    break;
                }
            }
        }
    }

    let localPath: string;

    if (typeof serverSourceRoot !== 'undefined' && serverSourceRoot && typeof localSourceRoot !== 'undefined' && localSourceRoot) {
        // get the part of the path that is relative to the source root
        const pathRelativeToSourceRoot = (serverIsWindows ? path.win32 : path.posix).relative(serverSourceRoot, serverPath);

        // resolve from the local source root
        localPath = path.resolve(localSourceRoot, pathRelativeToSourceRoot);

    } else {
        localPath = path.normalize(serverPath);
    }

    return localPath;
}

/** converts a local path from VS Code to a server-side XDebug file URI with respect to source root settings */
export function convertClientPathToDebugger(localPath: string, localSourceRoot?: string, serverSourceRoot?: string, pathMapping?: { [index: string]: string; }): string {

    let localFileUri = fileUrl(localPath, {resolve: false});
    let serverFileUri: string;

    if ( typeof pathMapping !== 'undefined' && pathMapping !== {} ) {
        let mappedServerSource: string;

        for (mappedServerSource of Object.keys(pathMapping) ) {
            let mappedLocalSource: string = pathMapping[mappedServerSource];

            let localRelative: string = path.relative(mappedLocalSource, localPath);

            if ( localRelative && localRelative.length > 0 ) {
                let relative: number = localRelative.indexOf('..');

                // if does not start with ..
                if ( relative !== 0 ) {
                    serverSourceRoot = mappedServerSource;
                    localSourceRoot = mappedLocalSource;

                    break;
                }
            }
        }
    }

    if (typeof serverSourceRoot !== 'undefined' && serverSourceRoot && typeof localSourceRoot !== 'undefined' && localSourceRoot) {
        let localSourceRootUrl = fileUrl(localSourceRoot, {resolve: false});
        if (!localSourceRootUrl.endsWith('/')) {
            localSourceRootUrl += '/';
        }
        let serverSourceRootUrl = fileUrl(serverSourceRoot, {resolve: false});
        if (!serverSourceRootUrl.endsWith('/')) {
            serverSourceRootUrl += '/';
        }
        // get the part of the path that is relative to the source root
        const urlRelativeToSourceRoot = urlRelative(localSourceRootUrl, localFileUri);
        // resolve from the server source root
        serverFileUri = url.resolve(serverSourceRootUrl, urlRelativeToSourceRoot);
    } else {
        serverFileUri = localFileUri;
    }
    return serverFileUri;
}

function isWindowsUri(path: string): boolean {
    return /^file:\/\/\/[a-zA-Z]:\//.test(path);
}

export function isSameUri(clientUri: string, debuggerUri: string): boolean {
    if (isWindowsUri(clientUri) || isWindowsUri(debuggerUri)) {
        // compare case-insensitive on Windows
        return debuggerUri.toLowerCase() === clientUri.toLowerCase();
    } else {
        return debuggerUri === clientUri;
    }
}

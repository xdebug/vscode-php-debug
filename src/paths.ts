
import urlRelative from 'url-relative';
import fileUrl from 'file-url';
import * as url from 'url';
import * as path from 'path';

/** converts a server-side XDebug file URI to a local path for VS Code with respect to source root settings */
export function convertDebuggerPathToClient(fileUri: string|url.Url, localSourceRoot?: string, serverSourceRoot?: string): string {
    if (typeof fileUri === 'string') {
        fileUri = url.parse(<string>fileUri);
    }
    // convert the file URI to a path
    let serverPath = decodeURI((<url.Url>fileUri).pathname);
    // strip the trailing slash from Windows paths (indicated by a drive letter with a colon)
    const serverIsWindows = /^\/[a-zA-Z]:\//.test(serverPath);
    if (serverIsWindows) {
        serverPath = serverPath.substr(1);
    }
    let localPath: string;
    if (serverSourceRoot && localSourceRoot) {
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
export function convertClientPathToDebugger(localPath: string, localSourceRoot?: string, serverSourceRoot?: string): string {
    let localFileUri = fileUrl(localPath, {resolve: false});
    let serverFileUri: string;
    if (serverSourceRoot && localSourceRoot) {
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

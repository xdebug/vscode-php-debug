import stringReplaceAsync from 'string-replace-async'
import { isWindowsUri } from './paths'

export class LogPointManager {
    private _logpoints = new Map<string, Map<number, string>>()

    public addLogPoint(fileUri: string, lineNumber: number, logMessage: string) {
        if (isWindowsUri(fileUri)) {
            fileUri = fileUri.toLowerCase()
        }
        if (!this._logpoints.has(fileUri)) {
            this._logpoints.set(fileUri, new Map<number, string>())
        }
        this._logpoints.get(fileUri)!.set(lineNumber, logMessage)
    }

    public clearFromFile(fileUri: string) {
        if (isWindowsUri(fileUri)) {
            fileUri = fileUri.toLowerCase()
        }
        if (this._logpoints.has(fileUri)) {
            this._logpoints.get(fileUri)!.clear()
        }
    }

    public hasLogPoint(fileUri: string, lineNumber: number): boolean {
        if (isWindowsUri(fileUri)) {
            fileUri = fileUri.toLowerCase()
        }
        return this._logpoints.has(fileUri) && this._logpoints.get(fileUri)!.has(lineNumber)
    }

    public async resolveExpressions(
        fileUri: string,
        lineNumber: number,
        callback: (expr: string) => Promise<string>
    ): Promise<string> {
        if (isWindowsUri(fileUri)) {
            fileUri = fileUri.toLowerCase()
        }
        if (!this.hasLogPoint(fileUri, lineNumber)) {
            return Promise.reject('Logpoint not found')
        }
        const expressionRegex = /\{(.*?)\}/gm
        return await stringReplaceAsync(
            this._logpoints.get(fileUri)!.get(lineNumber)!,
            expressionRegex,
            function (_: string, group: string) {
                return group.length === 0 ? Promise.resolve('') : callback(group)
            }
        )
    }
}

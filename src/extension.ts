import * as vscode from 'vscode'
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode'
import { LaunchRequestArguments } from './phpDebug'
import * as which from 'which'

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('php', {
            async resolveDebugConfiguration(
                folder: WorkspaceFolder | undefined,
                debugConfiguration: DebugConfiguration & LaunchRequestArguments,
                token?: CancellationToken
            ): Promise<ProviderResult<DebugConfiguration>> {
                if (!debugConfiguration.type && !debugConfiguration.request && !debugConfiguration.name) {
                    const editor = vscode.window.activeTextEditor
                    if (editor && editor.document.languageId === 'php') {
                        debugConfiguration.type = 'php'
                        debugConfiguration.name = 'Launch (dynamic)'
                        debugConfiguration.request = 'launch'
                        debugConfiguration.program = '${file}'
                        debugConfiguration.cwd = '${fileDirname}'
                        debugConfiguration.port = 0
                        debugConfiguration.runtimeArgs = ['-dxdebug.start_with_request=yes']
                        debugConfiguration.env = {
                            XDEBUG_MODE: 'debug,develop',
                            XDEBUG_CONFIG: 'client_port=${port}',
                        }
                        // debugConfiguration.stopOnEntry = true
                    }
                }
                if (
                    (debugConfiguration.program || debugConfiguration.runtimeArgs) &&
                    !debugConfiguration.runtimeExecutable
                ) {
                    // See if we have runtimeExecutable configured
                    const conf = vscode.workspace.getConfiguration('php.debug')
                    const executablePath = conf.get<string>('executablePath')
                    if (executablePath) {
                        debugConfiguration.runtimeExecutable = executablePath
                    }
                    // See if it's in path
                    if (!debugConfiguration.runtimeExecutable) {
                        try {
                            await which.default('php')
                        } catch (e) {
                            const selected = await vscode.window.showErrorMessage(
                                'PHP executable not found. Install PHP and add it to your PATH or set the php.debug.executablePath setting',
                                'Open settings'
                            )
                            if (selected === 'Open settings') {
                                await vscode.commands.executeCommand('workbench.action.openGlobalSettings', {
                                    query: 'php.debug.executablePath',
                                })
                                return undefined
                            }
                        }
                    }
                }
                if (debugConfiguration.proxy?.enable === true) {
                    // Proxy configuration
                    if (!debugConfiguration.proxy.key) {
                        const conf = vscode.workspace.getConfiguration('php.debug')
                        const ideKey = conf.get<string>('ideKey')
                        if (ideKey) {
                            debugConfiguration.proxy.key = ideKey
                        }
                    }
                }
                return debugConfiguration
            },
        })
    )
    context.subscriptions.push(
        vscode.languages.registerEvaluatableExpressionProvider('php', {
            async provideEvaluatableExpression(
                document: vscode.TextDocument,
                position: vscode.Position,
                token: CancellationToken
            ): Promise<ProviderResult<vscode.EvaluatableExpression>> {
                // see https://www.php.net/manual/en/language.variables.basics.php
                // const wordRange = document.getWordRangeAtPosition(position, /\$([a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*)((->(?1))|\[(\d+|'[^']+'|"[^"]+"|(?0))\])*/)
                const wordRange = document.getWordRangeAtPosition(
                    position,
                    /\$[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*(->[a-zA-Z_\x80-\xff][a-zA-Z0-9_\x80-\xff]*)*/
                )
                if (wordRange) {
                    return new vscode.EvaluatableExpression(wordRange)
                }
                return undefined // nothing evaluatable found under mouse
            },
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('php.debug.debugPhpFile', async (uri: vscode.Uri) => {
            vscode.debug.startDebugging(undefined, { type: '', name: '', request: '' })
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('php.debug.startWithStopOnEntry', async (uri: vscode.Uri) => {
            vscode.commands.executeCommand('workbench.action.debug.start', {
                config: {
                    stopOnEntry: true,
                },
            })
        })
    )
}

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
                        debugConfiguration.stopOnEntry = true
                    }
                }
                if (debugConfiguration.program && !debugConfiguration.runtimeExecutable) {
                    // See if we have runtimeExecutable configured
                    const conf = vscode.workspace.getConfiguration('php')
                    const executablePath =
                        conf.get<string>('executablePath') || conf.get<string>('validate.executablePath')
                    if (executablePath) {
                        debugConfiguration.runtimeExecutable = executablePath
                    }
                    // See if it's in path
                    if (!debugConfiguration.runtimeExecutable) {
                        try {
                            await which.default('php')
                        } catch (e) {
                            const selected = await vscode.window.showErrorMessage(
                                'PHP executable not found. Install PHP and add it to your PATH or set the php.executablePath setting',
                                'Open settings'
                            )
                            if (selected === 'Open settings') {
                                await vscode.commands.executeCommand('workbench.action.openGlobalSettings', {
                                    query: 'php.executablePath',
                                })
                                return undefined
                            }
                        }
                    }
                }
                return debugConfiguration
            },
        })
    )
}

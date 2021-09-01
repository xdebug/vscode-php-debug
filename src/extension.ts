import * as vscode from 'vscode'
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode'

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('php', {
            resolveDebugConfiguration(
                folder: WorkspaceFolder | undefined,
                debugConfiguration: DebugConfiguration,
                token?: CancellationToken
            ): ProviderResult<DebugConfiguration> {
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
                return debugConfiguration
            },
        })
    )
}

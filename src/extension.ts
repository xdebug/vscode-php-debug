import * as vscode from 'vscode'
import { WorkspaceFolder, DebugConfiguration, CancellationToken } from 'vscode'
import { LaunchRequestArguments } from './phpDebug'
import * as which from 'which'
import * as path from 'path'

/**
 * Resolves environment variables in a string
 * Supports: ${env:VAR_NAME}
 */
export function resolveEnvVariables(value: string): string {
    // Replace ${env:VAR_NAME} with environment variable values
    return value.replace(/\$\{env:([^}]+)\}/g, (match, envVar) => {
        const envValue = process.env[envVar]
        return envValue !== undefined ? envValue : match
    })
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('php', {
            async resolveDebugConfiguration(
                folder: WorkspaceFolder | undefined,
                debugConfiguration: DebugConfiguration & LaunchRequestArguments,
                token?: CancellationToken
            ): Promise<DebugConfiguration | undefined> {
                const isDynamic =
                    (!debugConfiguration.type || debugConfiguration.type === 'php') &&
                    !debugConfiguration.request &&
                    !debugConfiguration.name
                if (isDynamic) {
                    const editor = vscode.window.activeTextEditor
                    if (editor && editor.document.languageId === 'php') {
                        debugConfiguration.type = 'php'
                        debugConfiguration.name = 'Launch (dynamic)'
                        debugConfiguration.request = 'launch'
                        debugConfiguration.program = debugConfiguration.program || '${file}'
                        debugConfiguration.cwd = debugConfiguration.cwd || '${fileDirname}'
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
                if (debugConfiguration.pathMappings) {
                    const resolvedMappings: { [index: string]: string } = {}
                    for (const [serverPath, localPath] of Object.entries(debugConfiguration.pathMappings)) {
                        const resolvedServerPath = resolveEnvVariables(serverPath)
                        let resolvedLocalPath = resolveEnvVariables(localPath)

                        if (folder && folder.uri.scheme !== 'file') {
                            resolvedLocalPath = resolvedLocalPath.replace('${workspaceFolder}', folder.uri.toString())
                        }

                        resolvedMappings[resolvedServerPath] = resolvedLocalPath
                    }
                    debugConfiguration.pathMappings = resolvedMappings
                }
                // The following path are currently NOT mapped
                /*
                debugConfiguration.skipEntryPaths = debugConfiguration.skipEntryPaths?.map(v =>
                    v.replace('${workspaceFolder}', folder.uri.toString())
                )
                debugConfiguration.skipFiles = debugConfiguration.skipFiles?.map(v =>
                    v.replace('${workspaceFolder}', folder.uri.toString())
                )
                debugConfiguration.ignore = debugConfiguration.ignore?.map(v =>
                    v.replace('${workspaceFolder}', folder.uri.toString())
                )
                */
                return debugConfiguration
            },
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('extension.php-debug.runEditorContents', (resource: vscode.Uri) => {
            let targetResource = resource
            if (!targetResource && vscode.window.activeTextEditor) {
                targetResource = vscode.window.activeTextEditor.document.uri
            }
            if (targetResource) {
                void vscode.debug.startDebugging(undefined, {
                    type: 'php',
                    name: '',
                    request: '',
                    noDebug: true,
                    program: targetResource.fsPath,
                    cwd: path.dirname(targetResource.fsPath),
                })
            }
        }),
        vscode.commands.registerCommand('extension.php-debug.debugEditorContents', (resource: vscode.Uri) => {
            let targetResource = resource
            if (!targetResource && vscode.window.activeTextEditor) {
                targetResource = vscode.window.activeTextEditor.document.uri
            }
            if (targetResource) {
                void vscode.debug.startDebugging(undefined, {
                    type: 'php',
                    name: '',
                    request: '',
                    stopOnEntry: true,
                    program: targetResource.fsPath,
                    cwd: path.dirname(targetResource.fsPath),
                })
            }
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('extension.php-debug.startWithStopOnEntry', async (uri: vscode.Uri) => {
            await vscode.commands.executeCommand('workbench.action.debug.start', {
                config: {
                    stopOnEntry: true,
                },
            })
        })
    )
}

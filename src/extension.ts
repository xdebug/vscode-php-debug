import * as vscode from 'vscode'
import { PhpDebugSession, StartRequestArguments } from './phpDebug'

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
            if (event.event === 'newDbgpConnection') {
                const config: vscode.DebugConfiguration & StartRequestArguments = {
                    ...event.session.configuration,
                }
                config.request = 'launch'
                config.name = 'DBGp connection ' + event.body.connId
                config.connId = event.body.connId
                vscode.debug.startDebugging(undefined, config)
            }
        })
    )

    const factory = new InlineDebugAdapterFactory()
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('php', factory))
    if ('dispose' in factory) {
        context.subscriptions.push(factory)
    }
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        // since DebugAdapterInlineImplementation is proposed API, a cast to <any> is required for now
        const dap = new PhpDebugSession()
        dap.setFromExtension(true)
        return <any>new vscode.DebugAdapterInlineImplementation(dap)
    }
}

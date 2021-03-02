import * as vscode from 'vscode'
import { PhpDebugSession } from './phpDebug'

export function activate(context: vscode.ExtensionContext) {
    console.log('activate')

    context.subscriptions.push(
        vscode.debug.onDidStartDebugSession(session => {
            console.log('onDidStartDebugSession', session)
            // session.customRequest('test1', { test2: "test3" })
        })
    )
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession(session => {
            console.log('onDidTerminateDebugSession', session)
        })
    )

    context.subscriptions.push(
        vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
            console.log('onDidReceiveDebugSessionCustomEvent', event)
            if (event.event === 'newDbgpConnection') {
                const config: vscode.DebugConfiguration = {
                    ...event.session.configuration,
                }
                config.request = 'attach'
                config.name = 'DBGp connection ' + event.body.connId
                config.connId = event.body.connId
                vscode.debug.startDebugging(undefined, config, event.session)
            }
        })
    )

    const factory = new InlineDebugAdapterFactory()
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('php', factory))
    if ('dispose' in factory) {
        context.subscriptions.push(factory)
    }
}

export function deactivate() {
    console.log('deactivate')
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        // since DebugAdapterInlineImplementation is proposed API, a cast to <any> is required for now
        return <any>new vscode.DebugAdapterInlineImplementation(new PhpDebugSession())
    }
}

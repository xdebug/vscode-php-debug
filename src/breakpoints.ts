import { DebugProtocol as VSCodeDebugProtocol } from '@vscode/debugprotocol'
import * as vscode from '@vscode/debugadapter'
import { EventEmitter } from 'events'
import * as xdebug from './xdebugConnection'
import * as util from 'util'

export declare interface BreakpointManager {
    on(event: 'add', listener: (breakpoints: Map<number, xdebug.Breakpoint>) => void): this
    on(event: 'remove', listener: (breakpointIds: number[]) => void): this
    on(event: 'process', listener: () => void): this
}

/**
 * Keeps track of VS Code breakpoint IDs and maps them to Xdebug breakpoints.
 * Emits changes of breakpoints to BreakpointAdapter.
 */
export class BreakpointManager extends EventEmitter {
    private _lineBreakpoints = new Map<string, Map<number, xdebug.Breakpoint>>()
    private _exceptionBreakpoints = new Map<number, xdebug.Breakpoint>()
    private _callBreakpoints = new Map<number, xdebug.Breakpoint>()

    private _nextId = 1

    protected sourceKey(source: VSCodeDebugProtocol.Source): string {
        return source.path!
    }

    public setBreakPoints(
        source: VSCodeDebugProtocol.Source,
        fileUri: string,
        breakpoints: VSCodeDebugProtocol.SourceBreakpoint[]
    ): VSCodeDebugProtocol.Breakpoint[] {
        // let vscodeBreakpoints: VSCodeDebugProtocol.Breakpoint[]
        let toAdd = new Map<number, xdebug.Breakpoint>()
        const toRemove: number[] = []

        const sourceKey = this.sourceKey(source)

        // remove all existing breakpoints in the file
        if (this._lineBreakpoints.has(sourceKey)) {
            this._lineBreakpoints.get(sourceKey)?.forEach((_, key) => toRemove.push(key))
        }

        // clear all breakpoints in this path
        const sourceBreakpoints = new Map<number, xdebug.Breakpoint>()
        this._lineBreakpoints.set(sourceKey, sourceBreakpoints)

        const vscodeBreakpoints = breakpoints.map(sourceBreakpoint => {
            let xdebugBreakpoint: xdebug.Breakpoint
            let hitValue: number | undefined
            let hitCondition: xdebug.HitCondition | undefined
            if (sourceBreakpoint.hitCondition) {
                const match = sourceBreakpoint.hitCondition.match(/^\s*(>=|==|%)?\s*(\d+)\s*$/)
                if (match) {
                    hitCondition = (match[1] as xdebug.HitCondition) || '=='
                    hitValue = parseInt(match[2])
                } else {
                    const vscodeBreakpoint: VSCodeDebugProtocol.Breakpoint = {
                        verified: false,
                        line: sourceBreakpoint.line,
                        source: source,
                        // id: this._nextId++,
                        message:
                            'Invalid hit condition. Specify a number, optionally prefixed with one of the operators >= (default), == or %',
                    }
                    return vscodeBreakpoint
                }
            }
            if (sourceBreakpoint.condition) {
                xdebugBreakpoint = new xdebug.ConditionalBreakpoint(
                    sourceBreakpoint.condition,
                    fileUri,
                    sourceBreakpoint.line,
                    hitCondition,
                    hitValue
                )
            } else {
                xdebugBreakpoint = new xdebug.LineBreakpoint(fileUri, sourceBreakpoint.line, hitCondition, hitValue)
            }

            const vscodeBreakpoint: VSCodeDebugProtocol.Breakpoint = {
                verified: this.listeners('add').length === 0,
                line: sourceBreakpoint.line,
                source: source,
                id: this._nextId++,
            }

            sourceBreakpoints.set(vscodeBreakpoint.id!, xdebugBreakpoint)

            return vscodeBreakpoint
        })

        toAdd = sourceBreakpoints

        if (toRemove.length > 0) {
            this.emit('remove', toRemove)
        }
        if (toAdd.size > 0) {
            this.emit('add', toAdd)
        }

        return vscodeBreakpoints
    }

    public setExceptionBreakPoints(filters: string[]): VSCodeDebugProtocol.Breakpoint[] {
        const vscodeBreakpoints: VSCodeDebugProtocol.Breakpoint[] = []
        let toAdd = new Map<number, xdebug.Breakpoint>()
        const toRemove: number[] = []

        // always remove all breakpoints
        this._exceptionBreakpoints.forEach((_, key) => toRemove.push(key))
        this._exceptionBreakpoints.clear()

        filters.forEach(filter => {
            const xdebugBreakpoint: xdebug.Breakpoint = new xdebug.ExceptionBreakpoint(filter)
            const vscodeBreakpoint: VSCodeDebugProtocol.Breakpoint = {
                verified: this.listeners('add').length === 0,
                id: this._nextId++,
            }
            this._exceptionBreakpoints.set(vscodeBreakpoint.id!, xdebugBreakpoint)
            vscodeBreakpoints.push(vscodeBreakpoint)
        })

        toAdd = this._exceptionBreakpoints

        if (toRemove.length > 0) {
            this.emit('remove', toRemove)
        }
        if (toAdd.size > 0) {
            this.emit('add', toAdd)
        }

        return vscodeBreakpoints
    }

    public setFunctionBreakPointsRequest(
        breakpoints: VSCodeDebugProtocol.FunctionBreakpoint[]
    ): VSCodeDebugProtocol.Breakpoint[] {
        let vscodeBreakpoints: VSCodeDebugProtocol.Breakpoint[] = []
        let toAdd = new Map<number, xdebug.Breakpoint>()
        const toRemove: number[] = []

        // always remove all breakpoints
        this._callBreakpoints.forEach((_, key) => toRemove.push(key))
        this._callBreakpoints.clear()

        vscodeBreakpoints = breakpoints.map(functionBreakpoint => {
            let hitValue: number | undefined
            let hitCondition: xdebug.HitCondition | undefined
            if (functionBreakpoint.hitCondition) {
                const match = functionBreakpoint.hitCondition.match(/^\s*(>=|==|%)?\s*(\d+)\s*$/)
                if (match) {
                    hitCondition = (match[1] as xdebug.HitCondition) || '=='
                    hitValue = parseInt(match[2])
                } else {
                    const vscodeBreakpoint: VSCodeDebugProtocol.Breakpoint = {
                        verified: false,
                        // id: this._nextId++,
                        message:
                            'Invalid hit condition. Specify a number, optionally prefixed with one of the operators >= (default), == or %',
                    }
                    return vscodeBreakpoint
                }
            }
            const xdebugBreakpoint: xdebug.Breakpoint = new xdebug.CallBreakpoint(
                functionBreakpoint.name,
                functionBreakpoint.condition,
                hitCondition,
                hitValue
            )

            const vscodeBreakpoint: VSCodeDebugProtocol.Breakpoint = {
                verified: this.listeners('add').length === 0,
                id: this._nextId++,
            }
            this._callBreakpoints.set(vscodeBreakpoint.id!, xdebugBreakpoint)
            return vscodeBreakpoint
        })

        toAdd = this._callBreakpoints

        if (toRemove.length > 0) {
            this.emit('remove', toRemove)
        }
        if (toAdd.size > 0) {
            this.emit('add', toAdd)
        }

        return vscodeBreakpoints
    }

    public process(): void {
        // this will trigger a process on all adapters
        this.emit('process')
    }

    public getAll(): Map<number, xdebug.Breakpoint> {
        const toAdd = new Map<number, xdebug.Breakpoint>()
        for (const [_, lbp] of this._lineBreakpoints) {
            for (const [id, bp] of lbp) {
                toAdd.set(id, bp)
            }
        }
        for (const [id, bp] of this._exceptionBreakpoints) {
            toAdd.set(id, bp)
        }
        for (const [id, bp] of this._callBreakpoints) {
            toAdd.set(id, bp)
        }
        return toAdd
    }
}

interface AdapterBreakpoint {
    xdebugBreakpoint?: xdebug.Breakpoint
    state: 'add' | 'remove' | ''
    xdebugId?: number
}

export declare interface BreakpointAdapter {
    on(
        event: 'dapEvent',
        listener: (event: VSCodeDebugProtocol.BreakpointEvent | VSCodeDebugProtocol.OutputEvent) => void
    ): this
}

/**
 * Listens to changes from BreakpointManager and delivers them their own Xdebug Connection.
 * If DBGp connection is busy, track changes locally.
 */
export class BreakpointAdapter extends EventEmitter {
    private _connection: xdebug.Connection
    private _breakpointManager: BreakpointManager
    private _map = new Map<number, AdapterBreakpoint>()
    private _queue: (() => void)[] = []
    private _executing = false

    constructor(connection: xdebug.Connection, breakpointManager: BreakpointManager) {
        super()
        this._connection = connection
        this._breakpointManager = breakpointManager
        this._add(breakpointManager.getAll())
        // listeners
        this._breakpointManager.on('add', this._add)
        this._breakpointManager.on('remove', this._remove)
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        this._breakpointManager.on('process', this.process)
        this._connection.on('close', (error?: Error) => {
            this._breakpointManager.off('add', this._add)
            this._breakpointManager.off('remove', this._remove)
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            this._breakpointManager.off('process', this.process)
        })
        this._connection.on('notify_breakpoint_resolved', this._notify)
    }

    protected _add = (breakpoints: Map<number, xdebug.Breakpoint>): void => {
        breakpoints.forEach((xbp, id) => {
            this._queue.push(() => this._map.set(id, { xdebugBreakpoint: xbp, state: 'add' }))
        })
    }

    protected _remove = (breakpointIds: number[]): void => {
        breakpointIds.forEach(id => {
            this._queue.push(() => {
                if (this._map.has(id)) {
                    const bp = this._map.get(id)!
                    if (!bp.xdebugId) {
                        // has not been set
                        this._map.delete(id)
                        return
                    }
                    bp.state = 'remove'
                }
            })
        })
    }

    protected _notify = (notify: xdebug.BreakpointResolvedNotify): void => {
        if (
            notify.breakpoint.resolved === 'resolved' &&
            (notify.breakpoint instanceof xdebug.LineBreakpoint ||
                notify.breakpoint instanceof xdebug.ConditionalBreakpoint)
        ) {
            Array.from(this._map.entries())
                .filter(([id, abp]) => abp.xdebugId === notify.breakpoint.id)
                .map(([id, abp]) => {
                    this.emit(
                        'dapEvent',
                        new vscode.BreakpointEvent('changed', {
                            id: id,
                            verified: true,
                            line: (<xdebug.LineBreakpoint | xdebug.ConditionalBreakpoint>notify.breakpoint).line,
                        } as VSCodeDebugProtocol.Breakpoint)
                    )
                })
        }
    }

    private _processPromise: Promise<void>

    public process = (): Promise<void> => {
        if (this._executing) {
            return this._processPromise
        }
        this._processPromise = this.__process()
        return this._processPromise
    }

    protected __process = async (): Promise<void> => {
        if (this._executing) {
            // Protect from re-entry
            return
        }

        try {
            // Protect from re-entry
            this._executing = true

            // first execute all map modifying operations
            while (this._queue.length > 0) {
                const f = this._queue.shift()!
                f()
            }

            // do not execute network operations until network channel available
            if (this._connection.isPendingExecuteCommand) {
                return
            }

            for (const [id, abp] of this._map) {
                if (abp.state === 'remove') {
                    try {
                        await this._connection.sendBreakpointRemoveCommand(abp.xdebugId!)
                    } catch (err) {
                        this.emit('dapEvent', new vscode.OutputEvent(util.inspect(err) + '\n'))
                    }
                    this._map.delete(id)
                }
            }
            for (const [id, abp] of this._map) {
                if (abp.state === 'add') {
                    try {
                        const ret = await this._connection.sendBreakpointSetCommand(abp.xdebugBreakpoint!)
                        this._map.set(id, { xdebugId: ret.breakpointId, state: '' })
                        const extra: { line?: number } = {}
                        if (
                            ret.resolved === 'resolved' &&
                            (abp.xdebugBreakpoint!.type === 'line' || abp.xdebugBreakpoint!.type === 'conditional')
                        ) {
                            const bp = await this._connection.sendBreakpointGetCommand(ret.breakpointId)
                            extra.line = (<xdebug.LineBreakpoint | xdebug.ConditionalBreakpoint>bp.breakpoint).line
                        }
                        // TODO copy original breakpoint object
                        this.emit(
                            'dapEvent',
                            new vscode.BreakpointEvent('changed', {
                                id: id,
                                verified: ret.resolved !== 'unresolved',
                                ...extra,
                            } as VSCodeDebugProtocol.Breakpoint)
                        )
                    } catch (err) {
                        this.emit('dapEvent', new vscode.OutputEvent(util.inspect(err) + '\n'))
                        // TODO copy original breakpoint object
                        this.emit(
                            'dapEvent',
                            new vscode.BreakpointEvent('changed', {
                                id: id,
                                verified: false,
                                message: (<Error>err).message,
                            } as VSCodeDebugProtocol.Breakpoint)
                        )
                    }
                }
            }
        } catch (error) {
            this.emit('dapEvent', new vscode.OutputEvent(util.inspect(error) + '\n'))
        } finally {
            this._executing = false
        }

        // If there were any concurrent changes to the op-queue, rerun processing right away
        if (this._queue.length > 0) {
            return await this.__process()
        }
    }
}

/// <reference types="node" />
declare module 'abstract-socket' {
    export function createServer(listener: any): AbstractSocketServer
    export function connect(name: any, connectListener: any): net.Socket
    export function createConnection(name: any, connectListener: any): net.Socket
    class AbstractSocketServer extends net.Server {
        // constructor(listener: any);
        // listen(path: string, listener: () => void): net.Socket;
        // listen(path: string, listeningListener?: () => void): this;
    }
    import net = require('net')
    export {}
}

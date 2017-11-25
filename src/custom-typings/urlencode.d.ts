declare module 'urlencode' {
    export function decode(str: string, charset?: string): string
    export function encode(str: string, charset?: string): string
}

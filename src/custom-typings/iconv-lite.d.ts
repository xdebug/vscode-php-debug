declare module 'iconv-lite' {
    export function decode(data: Buffer, encoding: string): string;
    export function encode(data: string, encoding: string): Buffer;
    export function encodingExists(encoding: string): boolean;
}

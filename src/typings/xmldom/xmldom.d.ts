declare module 'xmldom' {
    interface DOMParserOptions {
        locator?: any;
        errorHandler?: ((level: string, msg: string) => any) | {
            warning?: (warning: any) => any;
            error?: (error: any) => any;
            fatalError?: (error: any) => any;
        };
    }
    export class DOMParser {
        constructor(options: DOMParserOptions);
        parseFromString(xml: string, mimeType: string): XMLDocument;
    }
}
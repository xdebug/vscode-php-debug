declare module 'file-url' {
    function fileUrl(path: string, options?: {resolve: boolean}): string;
    export = fileUrl;
}

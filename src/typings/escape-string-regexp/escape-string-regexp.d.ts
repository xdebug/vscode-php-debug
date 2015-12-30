declare module 'escape-string-regexp' {
    /** Escapes all special RegExp characters inside a string for use in the RegExp constructor */
    function escapeStringRegexp(string: string): string;
    export = escapeStringRegexp;
}
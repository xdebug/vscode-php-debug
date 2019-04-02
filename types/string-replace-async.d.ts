export = index
declare function index(
    str: string,
    re: RegExp | string,
    replacer: (match: string, ...args: any[]) => Promise<string>
): string
declare namespace index {
    function seq(str: string, re: RegExp | string, replacer: (match: string, ...args: any[]) => Promise<string>): string
}

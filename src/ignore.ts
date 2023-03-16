export function shouldIgnoreException(name: string, patterns: string[]): boolean {
    return patterns.some(pattern => name.match(convertPattern(pattern)))
}

function convertPattern(pattern: string): string {
    const esc = pattern.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d')
    const proc = esc.replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^\\\\]*')
    return '^' + proc + '$'
}

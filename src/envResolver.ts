/**
 * Resolves environment variables in a string
 * Supports: ${env:VAR_NAME}
 */
export function resolveEnvVariables(value: string): string {
    // Replace ${env:VAR_NAME} with environment variable values
    return value.replace(/\$\{env:([^}]+)\}/g, (match, envVar: string) => {
        const envValue = process.env[envVar]
        return envValue !== undefined ? envValue : match
    })
}

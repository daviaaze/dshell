/** User-facing text for a caught value, without the `Error:` prefix of `String(error)`. */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

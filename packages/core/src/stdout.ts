/**
 * Explicit stdout writer for protocol/CLI output.
 *
 * Unlike logger (diagnostics, may be filtered by level/category), this writes
 * directly to stdout — the correct channel when stdout itself is the contract
 * (e.g. the XDPH share-picker `[SELECTION]` protocol or `shade` CLI help).
 */
export default function printOut(text: string): void {
    print(text);
}

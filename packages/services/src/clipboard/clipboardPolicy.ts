/** Password-manager offers are never eligible for clipboard history. */
export const SENSITIVE_MIME_TYPES = [
    'x-kde-passwordManagerHint',
    'application/x-kde-passwordManagerHint',
    'application/x-keepassxc-clipboard-secret',
] as const;

/** Identify the actual image bytes, not wl-paste's generic `image` selector. */
export function imageMimeType(bytes: Uint8Array): string | null {
    const startsWith = (...signature: number[]) =>
        signature.every((value, index) => bytes[index] === value);
    if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
    if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (
        startsWith(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) ||
        startsWith(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)
    )
        return 'image/gif';
    if (startsWith(0x42, 0x4d)) return 'image/bmp';
    if (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a))
        return 'image/tiff';
    if (
        startsWith(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    )
        return 'image/webp';
    if (startsWith(0x00, 0x00, 0x01, 0x00)) return 'image/vnd.microsoft.icon';
    return null;
}

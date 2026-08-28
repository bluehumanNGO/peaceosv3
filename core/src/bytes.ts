export function utf8ToBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export function bytesToUtf8(input: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(input);
}

export function bytesToHex(input: Uint8Array): string {
  return Array.from(input, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(input: string): Uint8Array | null {
  if (!/^[0-9a-f]*$/i.test(input) || input.length % 2 !== 0) return null;
  const bytes = new Uint8Array(input.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(input.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToBase64(input: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of input) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(input).toString('base64');
}

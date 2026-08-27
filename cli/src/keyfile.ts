import { readFile, writeFile } from 'node:fs/promises';

export async function readPublicKeyFile(path: string): Promise<Uint8Array> {
  const bytes = await readFile(path);
  if (bytes.length !== 32) {
    throw new Error(`${path}: expected a 32-byte raw Ed25519 public key, got ${bytes.length} bytes`);
  }
  return bytes;
}

export async function readPrivateKeyFile(path: string): Promise<Uint8Array> {
  const bytes = await readFile(path);
  if (bytes.length !== 64) {
    throw new Error(`${path}: expected a 64-byte raw Ed25519 private key, got ${bytes.length} bytes`);
  }
  return bytes;
}

export interface KeypairPaths {
  publicKeyPath: string;
  privateKeyPath: string;
}

export async function writeKeypairFiles(
  prefix: string,
  keypair: { publicKey: Uint8Array; privateKey: Uint8Array },
): Promise<KeypairPaths> {
  const publicKeyPath = `${prefix}.pub`;
  const privateKeyPath = `${prefix}.key`;
  await writeFile(publicKeyPath, Buffer.from(keypair.publicKey));
  await writeFile(privateKeyPath, Buffer.from(keypair.privateKey));
  return { publicKeyPath, privateKeyPath };
}

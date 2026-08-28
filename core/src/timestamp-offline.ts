import { bytesToHex } from './bytes.js';
import { sha256 } from './canonical.js';
import type { TimestampAttestationSummary, TimestampCheckResult } from './timestamp-types.js';

const HEADER_MAGIC = new Uint8Array([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00,
  0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

const MAJOR_VERSION = 1;
const MAX_MSG_LENGTH = 4096;
const MAX_RESULT_LENGTH = 4096;
const MAX_ATTESTATION_PAYLOAD_SIZE = 8192;
const MAX_URI_LENGTH = 1000;
const PENDING_ATTESTATION_TAG = '83dfe30d2ef90c8e';
const BITCOIN_ATTESTATION_TAG = '0588960d73d71901';
const LITECOIN_ATTESTATION_TAG = '06869a0d73d71b45';

interface ParsedTimestamp {
  attestations: TimestampAttestationSummary[];
  hasUnknownAttestation: boolean;
}

interface ParsedOp {
  tag: number;
  arg?: Uint8Array;
}

class OtsParseError extends Error {}

class OtsUnsupportedError extends Error {}

class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readByte(): number {
    if (this.offset >= this.bytes.length) {
      throw new OtsParseError('Unexpected end of OpenTimestamps proof.');
    }
    return this.bytes[this.offset++]!;
  }

  readBytes(length: number): Uint8Array {
    if (length < 0) {
      throw new OtsParseError(`Invalid byte length ${length}.`);
    }
    if (this.offset + length > this.bytes.length) {
      throw new OtsParseError('Unexpected end of OpenTimestamps proof.');
    }
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readVaruint(): number {
    let value = 0;
    let shift = 0;
    for (let i = 0; i < 10; i++) {
      const byte = this.readByte();
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) {
          throw new OtsParseError('OpenTimestamps varuint exceeds JavaScript safe integer range.');
        }
        return value;
      }
      shift += 7;
    }
    throw new OtsParseError('OpenTimestamps varuint is too long.');
  }

  readVarbytes(maxLength: number, minLength = 0): Uint8Array {
    const length = this.readVaruint();
    if (length > maxLength) {
      throw new OtsParseError(`OpenTimestamps varbytes max length exceeded; ${length} > ${maxLength}.`);
    }
    if (length < minLength) {
      throw new OtsParseError(`OpenTimestamps varbytes min length not met; ${length} < ${minLength}.`);
    }
    return this.readBytes(length);
  }

  assertMagic(expected: Uint8Array): void {
    const actual = this.readBytes(expected.length);
    if (!bytesEqual(actual, expected)) {
      throw new OtsParseError('Bad OpenTimestamps proof magic.');
    }
  }

  assertEof(): void {
    if (this.offset !== this.bytes.length) {
      throw new OtsParseError('Trailing garbage found after end of OpenTimestamps proof.');
    }
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
}

function asciiFromBytes(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) {
    output += String.fromCharCode(byte);
  }
  return output;
}

function hexlify(bytes: Uint8Array): Uint8Array {
  return new TextEncoder().encode(bytesToHex(bytes));
}

async function webCryptoDigest(name: 'SHA-1' | 'SHA-256', bytes: Uint8Array): Promise<Uint8Array> {
  if (name === 'SHA-256') {
    return sha256(bytes);
  }
  const digest = await globalThis.crypto.subtle.digest(name, bytes.slice().buffer);
  return new Uint8Array(digest);
}

function digestLengthForCryptOp(tag: number): number {
  if (tag === 0x02 || tag === 0x03) return 20;
  if (tag === 0x08) return 32;
  throw new OtsParseError(`Unknown OpenTimestamps file hash operation tag 0x${tag.toString(16)}.`);
}

function parseOp(reader: Reader, tag: number): ParsedOp {
  if (tag === 0xf0 || tag === 0xf1) {
    return { tag, arg: reader.readVarbytes(MAX_RESULT_LENGTH, 1) };
  }
  if (tag === 0xf2 || tag === 0xf3 || tag === 0x02 || tag === 0x03 || tag === 0x08) {
    return { tag };
  }
  throw new OtsParseError(`Unknown OpenTimestamps operation tag 0x${tag.toString(16)}.`);
}

async function applyOp(op: ParsedOp, msg: Uint8Array): Promise<Uint8Array> {
  if (msg.length > MAX_MSG_LENGTH) {
    throw new OtsParseError(`OpenTimestamps message exceeds operation limit; ${msg.length} > ${MAX_MSG_LENGTH}.`);
  }

  let result: Uint8Array;
  if (op.tag === 0xf0) {
    result = concatBytes(msg, op.arg!);
  } else if (op.tag === 0xf1) {
    result = concatBytes(op.arg!, msg);
  } else if (op.tag === 0xf2) {
    if (msg.length === 0) throw new OtsParseError('Cannot reverse an empty OpenTimestamps message.');
    result = msg.slice().reverse();
  } else if (op.tag === 0xf3) {
    if (msg.length === 0) throw new OtsParseError('Cannot hexlify an empty OpenTimestamps message.');
    result = hexlify(msg);
  } else if (op.tag === 0x02) {
    result = await webCryptoDigest('SHA-1', msg);
  } else if (op.tag === 0x03) {
    throw new OtsUnsupportedError('OpenTimestamps RIPEMD-160 operation is not available in WebCrypto.');
  } else if (op.tag === 0x08) {
    result = await webCryptoDigest('SHA-256', msg);
  } else {
    throw new OtsParseError(`Unknown OpenTimestamps operation tag 0x${op.tag.toString(16)}.`);
  }

  if (result.length > MAX_RESULT_LENGTH) {
    throw new OtsParseError(`OpenTimestamps operation result exceeds limit; ${result.length} > ${MAX_RESULT_LENGTH}.`);
  }
  return result;
}

function parseAttestation(reader: Reader): { summary: TimestampAttestationSummary; unknown: boolean } {
  const tag = bytesToHex(reader.readBytes(8));
  const payload = reader.readVarbytes(MAX_ATTESTATION_PAYLOAD_SIZE);
  const payloadReader = new Reader(payload);

  if (tag === PENDING_ATTESTATION_TAG) {
    const uriBytes = payloadReader.readVarbytes(MAX_URI_LENGTH);
    payloadReader.assertEof();
    const uri = asciiFromBytes(uriBytes);
    if (!/^[A-Za-z0-9._/: -]+$/.test(uri) || uri.includes(' ')) {
      throw new OtsParseError('Invalid OpenTimestamps pending calendar URI.');
    }
    return { summary: { type: 'pending', detail: uri }, unknown: false };
  }

  if (tag === BITCOIN_ATTESTATION_TAG) {
    const height = payloadReader.readVaruint();
    payloadReader.assertEof();
    return { summary: { type: 'bitcoin', detail: `block height ${height}` }, unknown: false };
  }

  if (tag === LITECOIN_ATTESTATION_TAG) {
    const height = payloadReader.readVaruint();
    payloadReader.assertEof();
    return { summary: { type: 'litecoin', detail: `block height ${height}` }, unknown: false };
  }

  return {
    summary: { type: 'unknown', detail: `UnknownAttestation ${tag} ${bytesToHex(payload)}` },
    unknown: true,
  };
}

async function parseTimestamp(reader: Reader, initialMsg: Uint8Array, depth = 0): Promise<ParsedTimestamp> {
  if (depth > 1000) {
    throw new OtsParseError('OpenTimestamps proof exceeds recursion limit.');
  }

  const parsed: ParsedTimestamp = { attestations: [], hasUnknownAttestation: false };

  async function parseTagOrAttestation(tag: number): Promise<void> {
    if (tag === 0x00) {
      const attestation = parseAttestation(reader);
      parsed.attestations.push(attestation.summary);
      parsed.hasUnknownAttestation = parsed.hasUnknownAttestation || attestation.unknown;
      return;
    }

    const op = parseOp(reader, tag);
    const result = await applyOp(op, initialMsg);
    const child = await parseTimestamp(reader, result, depth + 1);
    parsed.attestations.push(...child.attestations);
    parsed.hasUnknownAttestation = parsed.hasUnknownAttestation || child.hasUnknownAttestation;
  }

  let tag = reader.readByte();
  while (tag === 0xff) {
    const current = reader.readByte();
    await parseTagOrAttestation(current);
    tag = reader.readByte();
  }
  await parseTagOrAttestation(tag);

  return parsed;
}

async function parseDetachedTimestampFile(proofBytes: Uint8Array): Promise<{ digestHex: string; timestamp: ParsedTimestamp }> {
  const reader = new Reader(proofBytes);
  reader.assertMagic(HEADER_MAGIC);

  const major = reader.readVaruint();
  if (major !== MAJOR_VERSION) {
    throw new OtsParseError(`Version ${major} detached timestamp files are not supported.`);
  }

  const fileHashOpTag = reader.readByte();
  const digestLength = digestLengthForCryptOp(fileHashOpTag);
  const fileDigest = reader.readBytes(digestLength);
  const timestamp = await parseTimestamp(reader, fileDigest);
  reader.assertEof();

  return { digestHex: bytesToHex(fileDigest), timestamp };
}

/**
 * Browser-safe, offline-only structural verification of an OpenTimestamps proof.
 * It never imports the OpenTimestamps package, Esplora, request/http, bitcore-lib,
 * fs, or Node crypto. Unknown proof features fail closed rather than being guessed.
 */
export async function verifyTimestampProofOffline(contentHashHex: string, proofBytes: Uint8Array): Promise<TimestampCheckResult> {
  let parsed: { digestHex: string; timestamp: ParsedTimestamp };
  try {
    parsed = await parseDetachedTimestampFile(proofBytes);
  } catch (err) {
    return {
      status: 'fail',
      level: 'bound',
      message: `Malformed OpenTimestamps proof: ${(err as Error).message}`,
      attestations: [],
    };
  }

  if (parsed.digestHex !== contentHashHex) {
    return {
      status: 'fail',
      level: 'bound',
      message:
        `Timestamp proof targets digest ${parsed.digestHex}, not this package's content_hash ` +
        `(${contentHashHex}) - this looks like a proof reused from a different package, not a proof ` +
        'for this one.',
      attestations: [],
    };
  }

  if (parsed.timestamp.hasUnknownAttestation) {
    return {
      status: 'fail',
      level: 'bound',
      message: 'Timestamp proof contains an unsupported attestation type; refusing to accept it offline.',
      attestations: parsed.timestamp.attestations,
    };
  }

  if (parsed.timestamp.attestations.length === 0) {
    return { status: 'fail', level: 'bound', message: 'Timestamp proof contains no attestations.', attestations: [] };
  }

  return {
    status: 'ok',
    level: 'bound',
    message:
      "Proof is well-formed and binds exactly this package's content_hash (offline check). " +
      'Timestamp not chain-confirmed; run with --check-bitcoin <esplora-url> to confirm.',
    attestations: parsed.timestamp.attestations,
  };
}

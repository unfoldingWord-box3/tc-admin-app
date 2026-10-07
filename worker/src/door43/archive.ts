// Door43's Scripture Burrito archive for any ref of any repository
// (`GET /api/v1/repos/{owner}/{repo}/sb/{ref}.zip`, E34): a Resource Container,
// translationStudio, or translationCore ref converted, a Scripture Burrito ref
// rolled up byte for byte (E1, E2, E3). tC Admin's only source of repository
// content, for a release's included books and for an import (ADR 0008). The
// archive has one top-level folder named after the repository, stripped here
// (E4). The zip is held whole (10.8 MB for an aligned Bible, E30) and each
// entry is inflated only when asked for, one at a time, with the runtime's own
// inflater (Q22); the zip format is read from the central directory, since
// Door43's writer uses data descriptors on some entries (E53). No dependency:
// stored and deflated entries are all Door43 writes. This module reads;
// nothing here writes (R3).

import { CatalogError } from '@tc-admin/shared/schema';
import { readDoor43Bytes } from './api';
import type { Door43Client } from './api';

/** One file of the archive, its path without the top-level folder. */
export interface ArchiveEntry {
  path: string;
  /** The uncompressed size the archive declares. */
  size: number;
}

export interface Archive {
  entries: ArchiveEntry[];
  /** The bytes of one file, inflated now; a path the archive lacks is `not_found`. */
  bytes(path: string): Promise<Uint8Array>;
}

interface RawEntry extends ArchiveEntry {
  method: number;
  compressed: number;
  offset: number;
  crc: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const END_LENGTH = 22;
const MAX_COMMENT = 0xffff;
const STORED = 0;
const DEFLATED = 8;

const malformed = (reason: string, details: Record<string, unknown> = {}) => new CatalogError('door43_unavailable', { details: { reason: `malformed archive: ${reason}`, ...details } });

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** The zip's CRC-32 of some bytes, checked against the one the central directory declares. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The zip's central directory: every file entry with where its data starts. Directory entries are skipped. */
export function zipEntries(zip: Uint8Array): RawEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end-of-central-directory record is at the end, before a comment of up to 64 KB; a candidate counts only when its comment ends the file.
  let end = -1;
  for (let i = zip.length - END_LENGTH; i >= Math.max(0, zip.length - END_LENGTH - MAX_COMMENT); i--) {
    if (view.getUint32(i, true) !== SIG_END || i + END_LENGTH + view.getUint16(i + 20, true) !== zip.length) continue;
    end = i;
    break;
  }
  if (end < 0) throw malformed('no end of central directory');
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) throw malformed('zip64 is not supported');
  if (directoryOffset + directorySize !== end) throw malformed('central directory does not end at the end record');
  const decoder = new TextDecoder();
  const entries: RawEntry[] = [];
  let at = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== SIG_CENTRAL) throw malformed('central directory entry', { index: i });
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const next = at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (next > end) throw malformed('central directory entry', { index: i });
    const path = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    at = next;
    if (path.endsWith('/')) continue;
    if (flags & 1) throw malformed('encrypted entry', { path });
    if (localOffset + 30 > directoryOffset || view.getUint32(localOffset, true) !== SIG_LOCAL) throw malformed('local header', { path });
    if (view.getUint16(localOffset + 8, true) !== method) throw malformed('local and central methods differ', { path });
    // The local header's own sizes may be zero when a data descriptor follows the data; the central directory's are authoritative.
    const offset = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (offset + compressed > directoryOffset) throw malformed('entry data beyond the archive', { path });
    entries.push({ path, size, method, compressed, offset, crc });
  }
  if (at !== end) throw malformed('central directory holds more than its count');
  return entries;
}

/**
 * Raw deflate, as a zip entry stores it, through the runtime's own inflater (a Web standard in Node and workerd alike).
 * Read chunk by chunk and stopped once past `limit`, so a lying size never inflates in full; an inflater failure is `door43_unavailable`.
 */
async function inflate(data: Uint8Array, limit: number, path: string): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      total += chunk.value.length;
      if (total > limit) {
        await reader.cancel();
        throw malformed('size differs from the one declared', { path, declared: limit });
      }
      chunks.push(chunk.value);
    }
  } catch (cause) {
    throw cause instanceof CatalogError ? cause : malformed('deflate data the inflater refused', { path });
  }
  const out = new Uint8Array(total);
  chunks.reduce((at, chunk) => (out.set(chunk, at), at + chunk.length), 0);
  return out;
}

/** A path the archive may hand on: no empty, `.` or `..` segment, no backslash, no NUL. */
const safePath = (path: string) => !path.includes('\\') && !path.includes('\0') && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');

/** The archive's one top-level folder (E4), or a failure when the entries do not share one. */
export function topLevelFolder(paths: readonly string[]): string {
  const folders = new Set(paths.map(path => path.split('/')[0]));
  if (folders.size !== 1 || paths.some(path => !path.includes('/'))) throw malformed('not one top-level folder', { folders: [...folders].slice(0, 5) });
  return [...folders][0]!;
}

/** The archive from its bytes: the entries without the top-level folder, and each file's bytes on demand. */
export function openArchive(zip: Uint8Array): Archive {
  const raw = zipEntries(zip);
  const top = topLevelFolder(raw.map(entry => entry.path));
  const files = new Map<string, RawEntry>();
  for (const entry of raw) {
    const path = entry.path.slice(top.length + 1);
    if (!safePath(entry.path)) throw malformed('unsafe path', { path: entry.path });
    if (files.has(path)) throw malformed('path listed twice', { path });
    files.set(path, entry);
  }
  return {
    entries: [...files].map(([path, entry]) => ({ path, size: entry.size })),
    async bytes(path) {
      const entry = files.get(path);
      if (!entry) throw new CatalogError('not_found', { details: { reason: 'no such file in the archive', path } });
      const data = zip.subarray(entry.offset, entry.offset + entry.compressed);
      let out: Uint8Array;
      // A copy, so a caller that changes the bytes changes neither the archive nor a later read.
      if (entry.method === STORED) out = data.slice();
      else if (entry.method === DEFLATED) out = await inflate(data, entry.size, path);
      else throw malformed('unsupported compression method', { path, method: entry.method });
      if (out.length !== entry.size) throw malformed('size differs from the one declared', { path, declared: entry.size, actual: out.length });
      if (crc32(out) !== entry.crc) throw malformed('CRC-32 differs from the one declared', { path });
      return out;
    },
  };
}

/** The Scripture Burrito archive of one ref (E34): downloaded whole, opened, its top-level folder stripped (E4). A ref Door43 cannot serve is `not_found`. */
export async function readArchive(client: Door43Client, owner: string, repo: string, ref: string): Promise<Archive> {
  // encodeURIComponent keeps `.` and `..`, which the URL would resolve out of /api/v1/repos with the token attached (A3).
  if ([owner, repo, ref].some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new CatalogError('unexpected', { details: { reason: 'invalid owner, repository or ref' } });
  }
  const zip = await readDoor43Bytes(client, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/sb/${encodeURIComponent(ref)}.zip`);
  return openArchive(zip);
}

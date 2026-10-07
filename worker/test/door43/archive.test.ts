// The Scripture Burrito archive client (#18): every recorded archive opens,
// its one top-level folder is stripped (E4), every file reads back whole,
// stored or deflated, and `metadata.json` is byte for byte the file beside
// the archive; the download goes to the API route with the session token
// (E34) and reads nothing but the archive (R3).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { CatalogError } from '@tc-admin/shared/schema';
import { describe, expect, test } from 'vitest';
import type { Fetch } from '../../src/door43/api';
import { MAX_ARCHIVE_BYTES, MAX_ENTRY_BYTES, openArchive, readArchive, topLevelFolder, zipEntries } from '../../src/door43/archive';
import { door43Host } from '../../src/door43/host';

const fixtures = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);
const bytes = (path: string) => new Uint8Array(readFileSync(new URL(path, fixtures)));
const text = (path: string) => readFileSync(new URL(path, fixtures), 'utf8');
const client = (fetch: Fetch) => ({ host: door43Host('https://qa.door43.org'), token: 'test-only', fetch });
const code = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? error.code : error));

/** The five recorded archives: the four formats (E1) and Open Bible Stories (E36), each with the file list and metadata extracted beside it. */
const ARCHIVES = [
  ['2026-09-21/sb-archives/bahtraku__Perjanjian-Baru-Pendau__master', 'sb', 'perjanjian-baru-pendau'],
  ['2026-09-21/sb-archives/bahtraku__id_tb1__master', 'rc', 'id_tb1'],
  ['2026-10-07/sb-archives/birch__es-419_tit_text_reg__master', 'ts', 'es-419_tit_text_reg'],
  ['2026-10-07/sb-archives/birch__en_web_mrk_book__master', 'tc', 'en_web_mrk_book'],
  ['2026-10-01/sb-archives/unfoldingWord__en_obs__v9', 'obs', 'en_obs'],
] as const;

describe('each recorded archive', () => {
  test.each(ARCHIVES)('%s (%s): the top-level folder is stripped and the files are the ones listed beside it (E4, E17)', (name, _format, top) => {
    const listed = text(`${name}.files.txt`).trim().split('\n');
    const archive = openArchive(bytes(`${name}.zip`));
    expect(topLevelFolder(listed)).toBe(top);
    const files = listed.filter(path => !path.endsWith('/')).map(path => path.slice(top.length + 1)).sort();
    expect(archive.entries.map(entry => entry.path).sort()).toEqual(files);
    expect(archive.entries.some(entry => entry.path.startsWith(`${top}/`) || entry.path.endsWith('/'))).toBe(false);
    expect(archive.entries.find(entry => entry.path === 'metadata.json')).toBeDefined();
  });

  test.each(ARCHIVES)('%s (%s): metadata.json reads back byte for byte, and every file matches the size the archive declares', async (name, _format) => {
    const archive = openArchive(bytes(`${name}.zip`));
    const metadata = await archive.bytes('metadata.json');
    expect(Buffer.from(metadata).equals(readFileSync(new URL(`${name}.metadata.json`, fixtures)))).toBe(true);
    for (const entry of archive.entries) expect((await archive.bytes(entry.path)).length, entry.path).toBe(entry.size);
  });

  test('R10: a book read from the archive has the md5 of the file on disk (E18); Door43 deflates every file (E53)', async () => {
    const name = '2026-09-21/sb-archives/bahtraku__id_tb1__master';
    const raw = zipEntries(bytes(`${name}.zip`));
    expect(new Set(raw.map(entry => entry.method))).toEqual(new Set([8]));
    const archive = openArchive(bytes(`${name}.zip`));
    const gen = await archive.bytes('ingredients/GEN.usfm');
    const expected = execFileSync('unzip', ['-p', new URL(`${name}.zip`, fixtures).pathname, 'id_tb1/ingredients/GEN.usfm']);
    expect(createHash('md5').update(gen).digest('hex')).toBe(createHash('md5').update(expected).digest('hex'));
    // The converted book is the default branch's file byte for byte (E18): its md5 is the one recorded there.
    const metadata = JSON.parse(text(`${name}.metadata.json`)) as { ingredients: Record<string, { checksum: { md5: string }; size: number }> };
    expect(metadata.ingredients['ingredients/GEN.usfm']!.checksum.md5).toBe(createHash('md5').update(gen).digest('hex'));
    expect(metadata.ingredients['ingredients/GEN.usfm']!.size).toBe(gen.length);
  });
});

/** A zip written by hand with stored entries, which Door43's archives do not hold (they deflate every file, E53), and a comment. */
function storedZip(entries: [string, string][], comment = 'made by the test'): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(14, crc32(data), true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const entry = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(entry.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc32(data), true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    parts.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }
  const directory = central.reduce((n, entry) => n + entry.length, 0);
  const commentBytes = encoder.encode(comment);
  const end = new Uint8Array(22 + commentBytes.length);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directory, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, commentBytes.length, true);
  end.set(commentBytes, 22);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('a stored entry and a comment', () => {
  test('a stored file reads back as it is, past a comment after the end record', async () => {
    const archive = openArchive(storedZip([['repo/', ''], ['repo/metadata.json', '{"format":"scripture burrito"}'], ['repo/ingredients/MAT.usfm', '\\id MAT\n']]));
    expect(archive.entries).toEqual([
      { path: 'metadata.json', size: 30 },
      { path: 'ingredients/MAT.usfm', size: 8 },
    ]);
    expect(new TextDecoder().decode(await archive.bytes('ingredients/MAT.usfm'))).toBe('\\id MAT\n');
    expect(JSON.parse(new TextDecoder().decode(await archive.bytes('metadata.json')))).toEqual({ format: 'scripture burrito' });
  });
});

describe('what the client refuses', () => {
  const reason = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return error instanceof CatalogError ? { code: error.code, reason: String(error.details.reason) } : error;
    }
    return null;
  };

  test('a path the archive lacks is not_found; bytes that are no archive, or no single top-level folder, are door43_unavailable with the reason', async () => {
    const archive = openArchive(bytes('2026-10-07/sb-archives/birch__en_web_mrk_book__master.zip'));
    expect(await code(archive.bytes('ingredients/GEN.usfm'))).toBe('not_found');
    expect(reason(() => openArchive(new Uint8Array([1, 2, 3])))).toEqual({ code: 'door43_unavailable', reason: 'malformed archive: no end of central directory' });
    expect(reason(() => openArchive(new TextEncoder().encode('not a zip at all, and long enough to scan for the end record signature')))).toMatchObject({ code: 'door43_unavailable' });
    expect(reason(() => openArchive(storedZip([['a/x', '1'], ['b/y', '2']])))).toEqual({ code: 'door43_unavailable', reason: 'malformed archive: not one top-level folder' });
    expect(reason(() => topLevelFolder(['a/x', 'y']))).toMatchObject({ reason: 'malformed archive: not one top-level folder' });
    // A size that is not the one declared is refused, never returned short or long.
    const lying = storedZip([['r/f.txt', 'abc']]);
    // The central directory starts after the one local header (30 bytes and the 7-byte name) and the 3 bytes of data; its uncompressed size is 24 bytes in.
    new DataView(lying.buffer).setUint32(30 + 7 + 3 + 24, 5, true);
    expect(await code(openArchive(lying).bytes('f.txt'))).toBe('door43_unavailable');
  });

  test('same-length corruption is refused by the CRC-32 the archive declares, stored or deflated', async () => {
    const stored = storedZip([['r/f.txt', 'abc']]);
    stored[37] = stored[37]! ^ 1;
    expect(await code(openArchive(stored).bytes('f.txt'))).toBe('door43_unavailable');
    const deflated = bytes('2026-10-07/sb-archives/birch__es-419_tit_text_reg__master.zip');
    deflated[737] = deflated[737]! ^ 1;
    expect(await code(openArchive(deflated).bytes('ingredients/TIT.usfm'))).toBe('door43_unavailable');
  });

  test('deflate data the inflater rejects is door43_unavailable, not a runtime error', async () => {
    const zip = bytes('2026-10-07/sb-archives/birch__es-419_tit_text_reg__master.zip');
    const entry = zipEntries(zip).find(raw => raw.path.endsWith('TIT.usfm'))!;
    zip.fill(0xff, entry.offset, entry.offset + entry.compressed);
    expect(await code(openArchive(zip).bytes('ingredients/TIT.usfm'))).toBe('door43_unavailable');
  });

  test('the end record is the one whose comment ends the file; a directory that overruns it or stops short is refused', () => {
    expect(openArchive(storedZip([['r/f.txt', 'abc']], 'PK\x05\x06 inside the comment')).entries).toEqual([{ path: 'f.txt', size: 3 }]);
    const overrun = storedZip([['r/f.txt', 'abc']]);
    new DataView(overrun.buffer).setUint16(30 + 7 + 3 + 28, 200, true);
    expect(reason(() => openArchive(overrun))).toMatchObject({ code: 'door43_unavailable' });
    const short = storedZip([['r/a', '1'], ['r/b', '2']]);
    new DataView(short.buffer).setUint16(short.length - END - 'made by the test'.length + 10, 1, true);
    expect(reason(() => openArchive(short))).toMatchObject({ code: 'door43_unavailable' });
  });

  test('an entry path with a dot segment, an empty segment or a backslash, or one listed twice, is refused', () => {
    for (const entries of [[['r/../x', '1']], [['r//x', '1']], [['r/a\\b', '1']], [['r/a', '1'], ['r/a', '2']]] as [string, string][][]) {
      expect(reason(() => openArchive(storedZip(entries))), JSON.stringify(entries)).toMatchObject({ code: 'door43_unavailable' });
    }
  });
});

const END = 22;

describe('the download', () => {
  test('A3, E34: the archive is read from the API route with the session token, and nothing else is read or written (R3)', async () => {
    const zip = bytes('2026-10-07/sb-archives/birch__es-419_tit_text_reg__master.zip');
    const calls: { url: string; method: string; redirect: string | undefined; authorization: string | null }[] = [];
    const archive = await readArchive(
      client(async (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET', redirect: init?.redirect, authorization: new Headers(init?.headers).get('authorization') });
        return new Response(zip, { status: 200, headers: { 'content-type': 'application/zip' } });
      }),
      'birch',
      'es-419_tit_text_reg',
      'master',
    );
    expect(calls).toEqual([{ url: 'https://qa.door43.org/api/v1/repos/birch/es-419_tit_text_reg/sb/master.zip', method: 'GET', redirect: 'manual', authorization: 'Bearer test-only' }]);
    expect(archive.entries.map(entry => entry.path).sort()).toEqual(['ingredients/LICENSE.md', 'ingredients/TIT.usfm', 'metadata.json']);
    expect(JSON.parse(new TextDecoder().decode(await archive.bytes('metadata.json')))).toMatchObject({ format: 'scripture burrito', meta: { generator: { softwareName: 'go-rc2sb' } } });
  });

  test('a ref Door43 cannot serve is not_found, a redirect is never followed, and an expired session is reported', async () => {
    expect(await code(readArchive(client(async () => new Response('', { status: 404 })), 'o', 'r', 'gone'))).toBe('not_found');
    expect(await code(readArchive(client(async () => new Response('', { status: 302, headers: { location: 'https://example.org/x.zip' } })), 'o', 'r', 'main'))).toBe('door43_unavailable');
    expect(await code(readArchive(client(async () => new Response('', { status: 401 })), 'o', 'r', 'main'))).toBe('session_expired');
  });

  test('A3: an owner, repository or ref that is empty, . or .. is refused before any request, so the token never leaves /api/v1/repos', async () => {
    let calls = 0;
    const counting = client(async () => (calls++, new Response('', { status: 404 })));
    for (const [owner, repo, ref] of [['..', '..', 'master'], ['o', '.', 'master'], ['o', 'r', '..'], ['', 'r', 'master']] as const) {
      expect(await code(readArchive(counting, owner, repo, ref))).toBe('unexpected');
    }
    expect(calls).toBe(0);
  });
});

describe('the ceilings (Q22, decided 7 October 2026)', () => {
  const client = (fetch: Fetch) => ({ host: door43Host('https://qa.door43.org'), token: 'test-only', fetch });
  const reason = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof CatalogError ? { code: error.code, reason: error.details.reason } : error));

  test('a download that declares more than 64 MB is refused before its body is read; one that streams more is refused as it passes the limit', async () => {
    expect(MAX_ARCHIVE_BYTES).toBe(64 * 1024 * 1024);
    // A body that cannot be read: were it read, the reason would be 'unreadable response body', not the limit.
    const broken = () => new ReadableStream<Uint8Array>({ pull() { throw new Error('read'); } });
    const declared = await reason(readArchive(client(async () => new Response(broken(), { status: 200, headers: { 'content-length': String(MAX_ARCHIVE_BYTES + 1) } })), 'o', 'r', 'main'));
    expect(declared).toEqual({ code: 'door43_unavailable', reason: 'archive larger than the limit' });
    expect(await reason(readArchive(client(async () => new Response(broken(), { status: 200 })), 'o', 'r', 'main'))).toEqual({ code: 'door43_unavailable', reason: 'unreadable response body' });
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const streamed = await reason(readArchive(client(async () => new Response(endless, { status: 200 })), 'o', 'r', 'main'));
    expect(streamed).toEqual({ code: 'door43_unavailable', reason: 'archive larger than the limit' });
    expect(sent).toBeLessThanOrEqual(MAX_ARCHIVE_BYTES + 2 * chunk.length);
  });

  test('an entry that declares more than 32 MB is refused before any byte of it is copied or inflated', async () => {
    expect(MAX_ENTRY_BYTES).toBe(32 * 1024 * 1024);
    const lying = storedZip([['r/big.usfm', 'abc']]);
    // The one central entry starts after the local header (30 bytes and the 10-byte name) and the 3 data bytes; its uncompressed size is 24 bytes in.
    new DataView(lying.buffer).setUint32(30 + 10 + 3 + 24, MAX_ENTRY_BYTES + 1, true);
    const archive = openArchive(lying);
    expect(archive.entries).toEqual([{ path: 'big.usfm', size: MAX_ENTRY_BYTES + 1 }]);
    expect(await reason(archive.bytes('big.usfm'))).toEqual({ code: 'door43_unavailable', reason: 'malformed archive: entry larger than the limit' });
  });
});

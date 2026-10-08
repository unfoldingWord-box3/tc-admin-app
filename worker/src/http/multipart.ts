// The input of an operation whose route takes `multipart/form-data`
// (`upload.plan`, operations.md §7, Q33): the files' bytes travel in the
// request, one part per field, `files.<i>.name`, `files.<i>.mode`, and
// `files.<i>.content`, with the confirmations as JSON in a `confirmations`
// part. This module turns the parts into the plain input the operation's
// schema validates: names as strings, a mode as a number, the bytes as a
// `Uint8Array`. A body larger than one upload batch and its framing is refused
// from its declared length before it is read, and, whatever it declared, as soon
// as the bytes read pass that limit, so the Worker never holds more. A part sent
// twice is refused, never resolved by the last copy.
// Same-origin and CSRF checks ran before this (csrf.ts, A4).

import { CatalogError, UPLOAD_CONFIRMATIONS_PART, UPLOAD_FILE_FIELDS } from '@tc-admin/shared/schema';
import type { UploadFileField } from '@tc-admin/shared/schema';
import type { Context } from 'hono';
import { UPLOAD_REQUEST_BYTES } from '../operations';
import type { App } from './app';

const PART = /^files\.(0|[1-9]\d{0,5})\.([a-z]+)$/;

const refused = (message: string, details: Record<string, unknown> = {}) => new CatalogError('validation_failed', { message, details });

/** One part's value as the schema reads it: text for a name, a number for a mode (an empty one is none), bytes for the content. */
async function fieldValue(field: UploadFileField, value: string | Blob): Promise<unknown> {
  if (field === 'content') return typeof value === 'string' ? value : new Uint8Array(await value.arrayBuffer());
  if (typeof value !== 'string') return value;
  if (field === 'mode') return value === '' ? null : /^\d{1,6}$/.test(value) ? Number(value) : value;
  return value;
}

const overLimit = (bytes: number) => refused(`files: the request is ${bytes} bytes, over the limit of ${UPLOAD_REQUEST_BYTES}`, { batch: { bytes, limit: UPLOAD_REQUEST_BYTES } });

/** The body's bytes, read with a running count; past `UPLOAD_REQUEST_BYTES` the stream is cancelled and the request refused, whatever its header said. */
async function boundedBody(stream: Request['body']): Promise<ArrayBuffer> {
  if (!stream) return new ArrayBuffer(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > UPLOAD_REQUEST_BYTES) {
      await reader.cancel().catch(() => {});
      throw overLimit(total);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

export async function readMultipartInput(c: Context<App>): Promise<Record<string, unknown>> {
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) throw refused('The request body must be multipart/form-data.');
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > UPLOAD_REQUEST_BYTES) throw overLimit(declared);
  // The declared length is a hint a client may omit or misstate (W6): the bytes
  // actually read are counted, and the stream is cancelled past the limit.
  const body = await boundedBody(c.req.raw.body);
  let form: FormData;
  try {
    form = await new Response(body, { headers: { 'content-type': c.req.header('content-type') ?? '' } }).formData();
  } catch {
    throw refused('The request body is not valid multipart form data.');
  }
  const entries = [...form.entries()];
  const files: Record<string, unknown>[] = [];
  const input: Record<string, unknown> = { files };
  const unknown: string[] = [];
  for (const [key, value] of entries) {
    if (key === UPLOAD_CONFIRMATIONS_PART) {
      if (typeof value !== 'string') throw refused('confirmations: the part must be JSON text.');
      try {
        input.confirmations = JSON.parse(value);
      } catch {
        throw refused('confirmations: the part is not valid JSON.');
      }
      continue;
    }
    const match = PART.exec(key);
    const field = match?.[2] as UploadFileField | undefined;
    // An index is never more than the parts sent, so no part can make a list longer than the request.
    const index = Number(match?.[1]);
    if (!match || !field || !UPLOAD_FILE_FIELDS.includes(field) || index >= entries.length) {
      unknown.push(key);
      continue;
    }
    const file = (files[index] ??= {});
    // A part sent twice is ambiguous: no copy silently wins.
    if (field in file) throw refused(`${key}: the part is sent more than once`, { fields: [{ path: key, message: 'sent more than once' }] });
    file[field] = await fieldValue(field, value as string | Blob);
  }
  if (unknown.length > 0) {
    const fields = unknown.map(key => ({ path: key, message: 'not a part of this operation' }));
    throw refused(fields.map(field => `${field.path}: ${field.message}`).join('; '), { fields });
  }
  // A hole in the indexes stays a hole, which the schema refuses as a missing file.
  return input;
}

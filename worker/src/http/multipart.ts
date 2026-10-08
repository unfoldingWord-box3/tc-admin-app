// The input of an operation whose route takes `multipart/form-data`
// (`upload.plan`, operations.md §7, Q33): the files' bytes travel in the
// request, one part per field, `files.<i>.name`, `files.<i>.mode`, and
// `files.<i>.content`, with the confirmations as JSON in a `confirmations`
// part. This module turns the parts into the plain input the operation's
// schema validates: names as strings, a mode as a number, the bytes as a
// `Uint8Array`. A body larger than one upload batch and its framing is refused
// from its declared length before it is read, so the Worker never holds more.
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

export async function readMultipartInput(c: Context<App>): Promise<Record<string, unknown>> {
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) throw refused('The request body must be multipart/form-data.');
  const declared = Number(c.req.header('content-length'));
  if (Number.isFinite(declared) && declared > UPLOAD_REQUEST_BYTES) {
    throw refused(`files: the request is ${declared} bytes, over the limit of ${UPLOAD_REQUEST_BYTES}`, { batch: { bytes: declared, limit: UPLOAD_REQUEST_BYTES } });
  }
  let form: FormData;
  try {
    form = await c.req.raw.formData();
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
    file[field] = await fieldValue(field, value as string | Blob);
  }
  if (unknown.length > 0) {
    const fields = unknown.map(key => ({ path: key, message: 'not a part of this operation' }));
    throw refused(fields.map(field => `${field.path}: ${field.message}`).join('; '), { fields });
  }
  // A hole in the indexes stays a hole, which the schema refuses as a missing file.
  return input;
}

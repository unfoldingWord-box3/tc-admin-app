// Recorded Door43 responses (ADR 0012) as the tests read them. A recording is
// stored gzipped when it is large enough to crowd a review packet or the
// repository; the reader inflates it, so a test names the file either way.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const FIXTURES = new URL('../../../fixtures/door43/qa.door43.org/', import.meta.url);

/** The recording's text, inflated when stored gzipped. */
export function recordedText(path: string): string {
  const bytes = readFileSync(new URL(path, FIXTURES));
  return (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
}

/** The recording's `response.json`, the answer Door43 gave. */
export function recorded<T>(path: string): T {
  return (JSON.parse(recordedText(path)) as { response: { json: T } }).response.json;
}

// MD5 for ingredient checksums (R10): the RFC 1321 test suite, and agreement
// with Node's digest across block boundaries, since Node is only the test runtime.
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { md5 } from '../../src/model/md5';

const text = (value: string) => new TextEncoder().encode(value);
const reference = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');

describe('md5', () => {
  test('R10: the RFC 1321 test suite', () => {
    expect(md5(text(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5(text('a'))).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5(text('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5(text('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5(text('abcdefghijklmnopqrstuvwxyz'))).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(md5(text('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'))).toBe('d174ab98d277d9f5a5611c2c9f419d9f');
    expect(md5(text('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  test('R10: agrees with Node across every length around the 64-byte block and padding boundaries', () => {
    for (let length = 0; length <= 200; length++) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(md5(bytes), `length ${length}`).toBe(reference(bytes));
    }
  });

  test('R10: agrees with Node on a book-sized file and on a view into a larger buffer', () => {
    const large = new Uint8Array(randomBytes(5 * 1024 * 1024 + 13));
    expect(md5(large)).toBe(reference(large));
    const view = large.subarray(1000, 1000 + 70_001);
    expect(md5(view)).toBe(reference(view));
  });
});

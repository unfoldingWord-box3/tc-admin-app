// MD5 (RFC 1321) for Scripture Burrito ingredient checksums (R10). Written out
// here because the Workers runtime's Web Crypto offers MD5 only as a
// non-standard extension and Node's not at all, so one implementation runs in
// both the Worker and the tests. The input is the file's bytes; the output is
// the 32-character lowercase hex digest the schema requires.

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const CONSTANTS = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

const rotateLeft = (value: number, bits: number) => ((value << bits) | (value >>> (32 - bits))) >>> 0;

export function md5(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >>> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const words = new Uint32Array(16);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let mix: number;
      let index: number;
      if (i < 16) {
        mix = (b & c) | (~b & d);
        index = i;
      } else if (i < 32) {
        mix = (d & b) | (~d & c);
        index = (5 * i + 1) % 16;
      } else if (i < 48) {
        mix = b ^ c ^ d;
        index = (3 * i + 5) % 16;
      } else {
        mix = c ^ (b | ~d);
        index = (7 * i) % 16;
      }
      const sum = (mix + a + CONSTANTS[i]! + words[index]!) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, SHIFTS[i]!)) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new DataView(new ArrayBuffer(16));
  digest.setUint32(0, a0, true);
  digest.setUint32(4, b0, true);
  digest.setUint32(8, c0, true);
  digest.setUint32(12, d0, true);
  return [...new Uint8Array(digest.buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

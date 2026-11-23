// Optical entropy pool.
//
// The lava lamp is rendered into a tiny off-screen render target. The pixels are read back,
// the least significant bit of each channel is collected, the bit stream is von Neumann
// debiased, mixed with crypto.getRandomValues and whitened with SHA-256.
// (Inspired by the Hybrid-Entropy-Computing-Platform project.)

export class EntropyPool {
  constructor() {
    this.pool = [];          // whitened, ready-to-use bytes
    this.rawBits = [];       // debiased bits waiting for whitening
    this.stats = { samples: 0, rawBits: 0, keptBits: 0, bytesOut: 0 };
    this.whitening = false;
    this.lastFrame = null;
  }

  // Feed RGBA pixels from the optical sensor (the lamp render target).
  feedPixels(pixels) {
    this.stats.samples++;
    // Frame difference amplifies the moving blobs and cancels the static background.
    const prev = this.lastFrame;
    let pending = null;
    for (let i = 0; i < pixels.length; i++) {
      if ((i & 3) === 3) continue; // skip alpha
      const v = prev ? (pixels[i] ^ prev[i]) : pixels[i];
      const bit = v & 1;
      this.stats.rawBits++;
      // von Neumann extractor: 01 -> 0, 10 -> 1, 00/11 -> discard
      if (pending === null) pending = bit;
      else {
        if (pending !== bit) { this.rawBits.push(pending); this.stats.keptBits++; }
        pending = null;
      }
    }
    this.lastFrame = pixels.slice();
    if (this.rawBits.length > 4096) this.rawBits.splice(0, this.rawBits.length - 4096);
    if (this.rawBits.length >= 256 && this.pool.length < 512) this.whiten();
  }

  async whiten() {
    if (this.whitening) return;
    this.whitening = true;
    const bits = this.rawBits.splice(0, 256);
    const buf = new Uint8Array(32 + 16);
    for (let i = 0; i < 256; i++) buf[i >> 3] |= bits[i] << (i & 7);
    crypto.getRandomValues(buf.subarray(32)); // mix in the OS CSPRNG
    try {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
      this.pool.push(...digest);
    } catch {
      // crypto.subtle needs a secure context (https or localhost); fall back to the CSPRNG only
      const fallback = new Uint8Array(32);
      crypto.getRandomValues(fallback);
      for (let i = 0; i < 32; i++) fallback[i] ^= buf[i];
      this.pool.push(...fallback);
    }
    this.whitening = false;
  }

  byte() {
    this.stats.bytesOut++;
    if (this.pool.length) return this.pool.shift();
    const b = new Uint8Array(1);
    crypto.getRandomValues(b);
    return b[0];
  }

  bytes(n) {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.byte();
    return out;
  }
}

export function shannon(bytes) {
  if (!bytes.length) return 0;
  const counts = new Array(256).fill(0);
  for (const b of bytes) counts[b]++;
  let h = 0;
  for (const c of counts) {
    if (!c) continue;
    const p = c / bytes.length;
    h -= p * Math.log2(p);
  }
  return h; // bits per byte, 0..8
}

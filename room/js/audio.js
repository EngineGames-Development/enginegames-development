// Tiny synthesized sound effects (WebAudio, no audio files). Starts on the first user gesture.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('engineRoomMuted') === '1'; } catch { /* storage may be blocked */ }
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    // white-noise buffer shared by hiss / static effects
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startHum();
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('engineRoomMuted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // one oscillator note with an attack/decay envelope
  tone(freq, dur = 0.12, { type = 'square', vol = 0.15, slide = 0, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  noiseBurst(dur = 0.3, { vol = 0.1, freq = 3000, q = 0.7, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  startHum() {
    // quiet computer-fan hum in the background
    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = 58;
    const g = this.ctx.createGain(); g.gain.value = 0.018;
    o.connect(g).connect(this.master);
    o.start();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.012;
    src.connect(f).connect(g2).connect(this.master);
    src.start();
  }

  // ---------------------------------------------------------------- named effects
  click() { this.tone(1800, 0.03, { type: 'square', vol: 0.05 }); }
  key() { this.tone(900 + Math.random() * 500, 0.025, { type: 'square', vol: 0.03 }); this.noiseBurst(0.03, { vol: 0.04, freq: 5000 }); }
  use() { this.tone(660, 0.07, { type: 'triangle', vol: 0.12 }); this.tone(990, 0.09, { type: 'triangle', vol: 0.1, delay: 0.05 }); }
  beep() { this.tone(880, 0.15, { type: 'square', vol: 0.08 }); }
  bootBeep() { this.tone(1000, 0.25, { type: 'square', vol: 0.08 }); }
  error() { this.tone(220, 0.18, { type: 'sawtooth', vol: 0.08 }); this.tone(160, 0.25, { type: 'sawtooth', vol: 0.08, delay: 0.12 }); }
  success() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.12, delay: i * 0.08 })); }
  fanfare() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.2, { type: 'square', vol: 0.07, delay: i * 0.1 })); }
  hiss() { this.noiseBurst(0.6, { vol: 0.12, freq: 6000, q: 0.4 }); }
  coin() { this.tone(988, 0.08, { type: 'square', vol: 0.07 }); this.tone(1319, 0.2, { type: 'square', vol: 0.07, delay: 0.08 }); }
  hurt() { this.tone(300, 0.25, { type: 'sawtooth', vol: 0.08, slide: -200 }); }
  squeak() { this.tone(1200, 0.12, { type: 'sine', vol: 0.12, slide: 600 }); this.tone(1500, 0.1, { type: 'sine', vol: 0.1, slide: 500, delay: 0.12 }); }
  quack() {
    this.tone(320, 0.18, { type: 'sawtooth', vol: 0.1, slide: -120 });
    this.noiseBurst(0.15, { vol: 0.05, freq: 900, q: 2 });
  }
  meow() { this.tone(700, 0.45, { type: 'triangle', vol: 0.1, slide: -250 }); this.tone(1050, 0.12, { type: 'sine', vol: 0.05 }); }
  purr(dur = 1.5) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 26;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(f).connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur);
  }
  switchClick() { this.noiseBurst(0.04, { vol: 0.15, freq: 2500, q: 3 }); this.tone(150, 0.05, { type: 'square', vol: 0.06 }); }
  whoosh() { this.noiseBurst(0.5, { vol: 0.08, freq: 800, q: 0.5 }); }

  // continuous drone buzz: returns a stop() function
  buzz() {
    if (!this.ctx) return () => {};
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 180;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 7;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 12;
    lfo.connect(lfoG).connect(o.frequency);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = this.ctx.createGain(); g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.05, this.ctx.currentTime + 0.4);
    o.connect(f).connect(g).connect(this.master);
    o.start(); lfo.start();
    this.buzzGain = g; this.buzzOsc = o;
    return () => {
      const t = this.ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.stop(t + 0.6); lfo.stop(t + 0.6);
    };
  }
}

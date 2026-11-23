// "Packet Catcher": an original mini arcade game rendered to a canvas texture.
// Move the firewall left/right, catch good packets and keys, block nothing red: malware costs a life.

const W = 480, H = 600;

export class PacketCatcher {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.keys = new Set();
    this.best = 0;
    try { this.best = Number(localStorage.getItem('packetCatcherBest')) || 0; } catch { /* storage may be blocked */ }
    this.state = 'title';
    this.onSound = null; // (name) => void, set by the room
    this.onScore = null; // (score) => void
    this.t = 0;
    this.stars = Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: 1 + Math.random() * 2 }));
    this.reset();
    this.dirty = true;
  }

  reset() {
    this.x = W / 2;
    this.score = 0;
    this.lives = 3;
    this.items = [];
    this.pops = [];
    this.spawn = 0;
    this.level = 1;
    this.shake = 0;
  }

  keydown(e) {
    const k = e.key;
    if (k === 'Enter' || k === ' ') {
      if (this.state !== 'play') { this.reset(); this.state = 'play'; this.onSound?.('use'); }
      e.preventDefault?.();
      return;
    }
    this.keys.add(k.length === 1 ? k.toLowerCase() : k);
  }
  keyup(e) { const k = e.key; this.keys.delete(k.length === 1 ? k.toLowerCase() : k); }
  releaseAll() { this.keys.clear(); }

  update(dt) {
    this.t += dt;
    for (const s of this.stars) { s.y += s.s * 30 * dt; if (s.y > H) { s.y = 0; s.x = Math.random() * W; } }
    if (this.state === 'play') {
      const speed = 420;
      if (this.keys.has('ArrowLeft') || this.keys.has('a')) this.x -= speed * dt;
      if (this.keys.has('ArrowRight') || this.keys.has('d')) this.x += speed * dt;
      this.x = Math.max(50, Math.min(W - 50, this.x));
      this.level = 1 + Math.floor(this.score / 150);
      this.spawn -= dt;
      if (this.spawn <= 0) {
        this.spawn = Math.max(0.28, 0.9 - this.level * 0.07);
        const r = Math.random();
        const kind = r < 0.58 ? 'packet' : r < 0.66 ? 'key' : 'bug';
        this.items.push({ kind, x: 30 + Math.random() * (W - 60), y: -30, vy: 110 + this.level * 22 + Math.random() * 60, wob: Math.random() * 6 });
      }
      for (const it of this.items) it.y += it.vy * dt;
      const padY = H - 70;
      this.items = this.items.filter((it) => {
        if (it.y > padY - 18 && it.y < padY + 14 && Math.abs(it.x - this.x) < 62) {
          if (it.kind === 'bug') { this.lives--; this.shake = 0.3; this.pop(it.x, it.y, '-1 ♥', '#ff5c7a'); this.onSound?.('hurt'); }
          else { const p = it.kind === 'key' ? 50 : 10; this.score += p; this.pop(it.x, it.y, `+${p}`, it.kind === 'key' ? '#ffcd3c' : '#55e07a'); this.onSound?.(it.kind === 'key' ? 'coin' : 'click'); this.onScore?.(this.score); }
          return false;
        }
        return it.y < H + 30;
      });
      if (this.lives <= 0) {
        this.state = 'over';
        this.onSound?.('error');
        if (this.score > this.best) {
          this.best = this.score;
          try { localStorage.setItem('packetCatcherBest', String(this.best)); } catch { /* ignore */ }
        }
      }
    }
    for (const p of this.pops) { p.y -= 50 * dt; p.life -= dt; }
    this.pops = this.pops.filter((p) => p.life > 0);
    this.shake = Math.max(0, this.shake - dt);
    this.render();
  }

  pop(x, y, text, color) { this.pops.push({ x, y, text, color, life: 0.8 }); }

  render() {
    const g = this.g;
    g.save();
    if (this.shake > 0) g.translate((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#1b1440'); grd.addColorStop(1, '#3b2470');
    g.fillStyle = grd; g.fillRect(-10, -10, W + 20, H + 20);
    g.fillStyle = '#ffffff55';
    for (const s of this.stars) g.fillRect(s.x, s.y, s.s, s.s);
    // binary rain columns in the background
    g.font = 'bold 14px monospace';
    g.fillStyle = '#ffffff14';
    for (let c = 0; c < 12; c++) for (let r = 0; r < 20; r++) g.fillText(((c * 7 + r * 3 + Math.floor(this.t * 4)) % 3) ? '1' : '0', c * 40 + 14, ((r * 32 + this.t * 40 * (1 + c % 3)) % (H + 40)) - 20);

    for (const it of this.items) this.drawItem(it);

    // firewall paddle
    const padY = H - 70;
    g.fillStyle = '#2b2340';
    roundRect(g, this.x - 64, padY - 14, 128, 32, 12); g.fill();
    g.fillStyle = '#ef5a5a';
    roundRect(g, this.x - 60, padY - 12, 120, 26, 10); g.fill();
    g.fillStyle = '#ffd0d0';
    for (let i = 0; i < 4; i++) g.fillRect(this.x - 52 + i * 28, padY - 6, 20, 6);
    g.fillStyle = '#c23b3b';
    for (let i = 0; i < 3; i++) g.fillRect(this.x - 38 + i * 28, padY + 3, 20, 6);
    g.fillStyle = '#fff'; g.font = 'bold 13px "Fredoka", sans-serif'; g.textAlign = 'center';
    g.fillText('FIREWALL', this.x, padY + 30);

    for (const p of this.pops) {
      g.globalAlpha = Math.min(1, p.life * 2);
      g.fillStyle = p.color; g.font = 'bold 26px "Fredoka", sans-serif';
      g.fillText(p.text, p.x, p.y);
      g.globalAlpha = 1;
    }

    // HUD
    g.fillStyle = '#2b2340cc'; g.fillRect(0, 0, W, 44);
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = 'bold 22px "Fredoka", sans-serif';
    g.fillText(`SCORE ${this.score}`, 14, 30);
    g.textAlign = 'center'; g.fillStyle = '#ffcd3c'; g.fillText(`LV ${this.level}`, W / 2, 30);
    g.textAlign = 'right'; g.fillStyle = '#ff5c7a'; g.fillText('♥'.repeat(Math.max(0, this.lives)), W - 14, 30);

    if (this.state !== 'play') {
      g.fillStyle = '#000000aa'; g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#ffcd3c'; g.font = 'bold 50px "Fredoka", sans-serif';
      g.fillText(this.state === 'title' ? 'PACKET' : 'GAME OVER', W / 2, 190);
      if (this.state === 'title') g.fillText('CATCHER', W / 2, 245);
      g.fillStyle = '#fff'; g.font = 'bold 20px "Fredoka", sans-serif';
      const lines = this.state === 'title'
        ? ['Catch packets and keys,', 'let malware fall past you!', '', '← → or A D to move']
        : [`score ${this.score}`, `best ${this.best}`];
      lines.forEach((l, i) => g.fillText(l, W / 2, 310 + i * 30));
      if (Math.floor(this.t * 2) % 2 === 0) { g.fillStyle = '#55e07a'; g.font = 'bold 26px "Fredoka", sans-serif'; g.fillText('PRESS ENTER', W / 2, 480); }
      g.fillStyle = '#ffffff88'; g.font = '16px "Fredoka", sans-serif'; g.fillText(`best ${this.best}`, W / 2, 540);
    }
    g.restore();
    this.dirty = true;
  }

  drawItem(it) {
    const g = this.g;
    const x = it.x + Math.sin(this.t * 3 + it.wob) * 6, y = it.y;
    g.lineWidth = 4; g.strokeStyle = '#2b2340';
    if (it.kind === 'packet') {
      g.fillStyle = '#55e07a';
      roundRect(g, x - 22, y - 15, 44, 30, 6); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(x - 20, y - 12); g.lineTo(x, y + 2); g.lineTo(x + 20, y - 12); g.stroke();
    } else if (it.kind === 'key') {
      g.fillStyle = '#ffcd3c';
      g.beginPath(); g.arc(x - 8, y, 11, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillRect(x, y - 4, 22, 8); g.strokeRect(x, y - 4, 22, 8);
      g.fillRect(x + 12, y + 4, 6, 8);
    } else {
      g.fillStyle = '#ff5c7a';
      for (let k = -1; k <= 1; k++) {
        g.beginPath(); g.moveTo(x - 14, y + k * 8); g.lineTo(x - 26, y + k * 10 + Math.sin(this.t * 12) * 3); g.stroke();
        g.beginPath(); g.moveTo(x + 14, y + k * 8); g.lineTo(x + 26, y + k * 10 - Math.sin(this.t * 12) * 3); g.stroke();
      }
      g.beginPath(); g.ellipse(x, y, 17, 20, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(x - 6, y - 5, 5, 0, Math.PI * 2); g.arc(x + 6, y - 5, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2b2340';
      g.beginPath(); g.arc(x - 6, y - 4, 2.5, 0, Math.PI * 2); g.arc(x + 6, y - 4, 2.5, 0, Math.PI * 2); g.fill();
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

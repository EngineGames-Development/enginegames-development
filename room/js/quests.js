// Quests / achievements: a checklist that guides visitors through the room.
// Progress is stored in localStorage; unlocking shows a toast and plays a jingle.

export const QUESTS = [
  ['terminal', 'Hello, kernel', 'Sit down at the CRT and use the SecureRustOS terminal'],
  ['cpu', 'Machine code', 'Run a program on the EG-8 CPU (Arduino, Pi, robot arm or `run`)'],
  ['crack', 'Reverse engineer', 'Crack crackme.bin on the laptop (`crackme <password>`)'],
  ['arcade', 'Firewall hero', 'Score 100 points in Packet Catcher'],
  ['solder', 'Hot hands', 'Solder all 8 joints on the circuit board'],
  ['scan', 'Contained', 'Put the viruses in the jar (run an antivirus scan)'],
  ['sql', 'SELECT * FROM fun', 'Query the database (filing cabinet or `sql` / `mongo`)'],
  ['make', 'It boots!', 'Build and boot SecureRustOS with `make run`'],
  ['entropy', 'Lava randomness', 'Harvest optical entropy from the lava lamp'],
  ['vault', 'Strong password', 'Generate a password in the EngineManager safe'],
  ['tux', 'Penguin comedy club', 'Hear 3 Linux jokes from Tux'],
  ['cat', 'Interrupt handler', 'Pet the sleeping cat'],
  ['duck', 'Rubber duck debugging', 'Explain your bug to the duck on the monitor'],
  ['drone', 'Liftoff', 'Launch the quadcopter drone'],
  ['night', 'Night shift', 'Turn off the lights'],
];

export class Quests {
  constructor({ list, chip, toast, onUnlock, onAllDone }) {
    this.el = { list, chip, toast };
    this.onUnlock = onUnlock;
    this.onAllDone = onAllDone;
    this.done = new Set();
    try { JSON.parse(localStorage.getItem('engineRoomQuests') || '[]').forEach((id) => this.done.add(id)); } catch { /* ignore */ }
    this.counters = {};
    this.toastTimer = null;
    this.render();
  }

  // count-based quests ("hear 3 jokes")
  bump(id, needed) {
    this.counters[id] = (this.counters[id] ?? 0) + 1;
    if (this.counters[id] >= needed) this.unlock(id);
  }

  unlock(id) {
    if (this.done.has(id)) return false;
    const q = QUESTS.find((x) => x[0] === id);
    if (!q) return false;
    this.done.add(id);
    try { localStorage.setItem('engineRoomQuests', JSON.stringify([...this.done])); } catch { /* ignore */ }
    this.render();
    this.showToast(`Quest complete: <b>${q[1]}</b>`, `${this.done.size} / ${QUESTS.length}`);
    this.onUnlock?.(q);
    if (this.done.size === QUESTS.length) setTimeout(() => this.onAllDone?.(), 1200);
    return true;
  }

  reset() {
    this.done.clear();
    this.counters = {};
    try { localStorage.removeItem('engineRoomQuests'); } catch { /* ignore */ }
    this.render();
  }

  showToast(title, sub) {
    const t = this.el.toast;
    t.innerHTML = `<span class="star">★</span><div>${title}<small>${sub}</small></div>`;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  }

  render() {
    this.el.chip.innerHTML = `★ Quests ${this.done.size}/${QUESTS.length} <kbd>Q</kbd>`;
    this.el.list.innerHTML = `<h3>Quests <small>${this.done.size}/${QUESTS.length}</small></h3>` + QUESTS.map(([id, title, hint]) =>
      `<div class="q ${this.done.has(id) ? 'done' : ''}"><span class="box">${this.done.has(id) ? '✓' : ''}</span><div><b>${title}</b><small>${hint.replace(/`([^`]+)`/g, '<code>$1</code>')}</small></div></div>`).join('');
  }

  next() {
    return QUESTS.find(([id]) => !this.done.has(id));
  }

  lines() {
    return QUESTS.map(([id, title, hint]) => `[${this.done.has(id) ? 'x' : ' '}] ${title.padEnd(22)} ${hint.replace(/`/g, '')}`);
  }
}

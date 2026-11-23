// EG-8: a tiny 8-bit CPU with an assembler and disassembler.
//
// Registers: A B C D (8-bit), PC, SP, flags Z (zero), C (carry/borrow), N (bit 7 set)
// Memory:    256 bytes. Programs load at 0x00, the stack grows down from 0xFF.
//
// Operand encodings (each operand is one byte):
//   r   = register index (A=0, B=1, C=2, D=3)
//   imm = 8-bit immediate
//   adr = 8-bit address

export const REGS = ['A', 'B', 'C', 'D'];

// opcode -> [mnemonic, operand kinds]
export const OPS = {
  0x00: ['NOP', []],
  0x01: ['HLT', []],
  0x10: ['MOV', ['r', 'imm']],
  0x11: ['MOV', ['r', 'r']],
  0x12: ['LD', ['r', '[adr]']],
  0x13: ['ST', ['[adr]', 'r']],
  0x14: ['LD', ['r', '[r]']],
  0x15: ['ST', ['[r]', 'r']],
  0x20: ['ADD', ['r', 'r']],
  0x21: ['ADD', ['r', 'imm']],
  0x22: ['SUB', ['r', 'r']],
  0x23: ['SUB', ['r', 'imm']],
  0x24: ['AND', ['r', 'r']],
  0x25: ['AND', ['r', 'imm']],
  0x26: ['OR', ['r', 'r']],
  0x27: ['OR', ['r', 'imm']],
  0x28: ['XOR', ['r', 'r']],
  0x29: ['XOR', ['r', 'imm']],
  0x2a: ['CMP', ['r', 'r']],
  0x2b: ['CMP', ['r', 'imm']],
  0x2c: ['INC', ['r']],
  0x2d: ['DEC', ['r']],
  0x2e: ['SHL', ['r']],
  0x2f: ['SHR', ['r']],
  0x30: ['NOT', ['r']],
  0x40: ['JMP', ['adr']],
  0x41: ['JZ', ['adr']],
  0x42: ['JNZ', ['adr']],
  0x43: ['JC', ['adr']],
  0x44: ['JNC', ['adr']],
  0x45: ['CALL', ['adr']],
  0x46: ['RET', []],
  0x50: ['PUSH', ['r']],
  0x51: ['POP', ['r']],
  0x60: ['OUT', ['imm', 'r']],
  0x61: ['IN', ['r', 'imm']],
  0x70: ['SLP', ['imm']],
};

// Reverse lookup: "MNEMONIC kind,kind" -> opcode
const ENCODE = {};
for (const [op, [m, kinds]] of Object.entries(OPS)) {
  ENCODE[`${m} ${kinds.join(',')}`] = Number(op);
}

export class CPU {
  constructor() {
    this.mem = new Uint8Array(256);
    this.ports = { out: () => {}, in: () => 0 };
    this.reset();
  }

  reset() {
    this.r = new Uint8Array(4);
    this.pc = 0;
    this.sp = 0xff;
    this.Z = 0; this.C = 0; this.N = 0;
    this.halted = true;
    this.sleep = 0; // remaining sleep in ms
    this.cycles = 0;
    this.error = null;
  }

  load(bytes) {
    this.mem.fill(0);
    this.mem.set(bytes.slice(0, 256));
    this.reset();
  }

  setFlags(v, carry = this.C) {
    this.Z = (v & 0xff) === 0 ? 1 : 0;
    this.N = v & 0x80 ? 1 : 0;
    this.C = carry ? 1 : 0;
  }

  fetch() {
    const v = this.mem[this.pc];
    this.pc = (this.pc + 1) & 0xff;
    return v;
  }

  push(v) { this.mem[this.sp] = v & 0xff; this.sp = (this.sp - 1) & 0xff; }
  pop() { this.sp = (this.sp + 1) & 0xff; return this.mem[this.sp]; }

  // Executes one instruction. Returns false when the CPU stops.
  step() {
    if (this.halted) return false;
    const op = this.fetch();
    const r = this.r;
    const def = OPS[op];
    if (!def) {
      this.error = `illegal opcode 0x${hex(op)} at 0x${hex((this.pc - 1) & 0xff)}`;
      this.halted = true;
      return false;
    }
    const a = def[1].length > 0 ? this.fetch() : 0;
    const b = def[1].length > 1 ? this.fetch() : 0;
    const ra = a & 3, rb = b & 3;
    let t;
    switch (op) {
      case 0x00: break;
      case 0x01: this.halted = true; break;
      case 0x10: r[ra] = b; break;
      case 0x11: r[ra] = r[rb]; break;
      case 0x12: r[ra] = this.mem[b]; break;
      case 0x13: this.mem[a] = r[rb]; break;
      case 0x14: r[ra] = this.mem[r[rb]]; break;
      case 0x15: this.mem[r[ra]] = r[rb]; break;
      case 0x20: t = r[ra] + r[rb]; r[ra] = t; this.setFlags(t, t > 0xff); break;
      case 0x21: t = r[ra] + b; r[ra] = t; this.setFlags(t, t > 0xff); break;
      case 0x22: t = r[ra] - r[rb]; r[ra] = t; this.setFlags(t, t < 0); break;
      case 0x23: t = r[ra] - b; r[ra] = t; this.setFlags(t, t < 0); break;
      case 0x24: r[ra] &= r[rb]; this.setFlags(r[ra], 0); break;
      case 0x25: r[ra] &= b; this.setFlags(r[ra], 0); break;
      case 0x26: r[ra] |= r[rb]; this.setFlags(r[ra], 0); break;
      case 0x27: r[ra] |= b; this.setFlags(r[ra], 0); break;
      case 0x28: r[ra] ^= r[rb]; this.setFlags(r[ra], 0); break;
      case 0x29: r[ra] ^= b; this.setFlags(r[ra], 0); break;
      case 0x2a: t = r[ra] - r[rb]; this.setFlags(t, t < 0); break;
      case 0x2b: t = r[ra] - b; this.setFlags(t, t < 0); break;
      case 0x2c: t = r[ra] + 1; r[ra] = t; this.setFlags(t, t > 0xff); break;
      case 0x2d: t = r[ra] - 1; r[ra] = t; this.setFlags(t, t < 0); break;
      case 0x2e: t = r[ra] << 1; r[ra] = t; this.setFlags(t, t & 0x100); break;
      case 0x2f: t = r[ra] & 1; r[ra] >>= 1; this.setFlags(r[ra], t); break;
      case 0x30: r[ra] = ~r[ra]; this.setFlags(r[ra], this.C); break;
      case 0x40: this.pc = a; break;
      case 0x41: if (this.Z) this.pc = a; break;
      case 0x42: if (!this.Z) this.pc = a; break;
      case 0x43: if (this.C) this.pc = a; break;
      case 0x44: if (!this.C) this.pc = a; break;
      case 0x45: this.push(this.pc); this.pc = a; break;
      case 0x46: this.pc = this.pop(); break;
      case 0x50: this.push(r[ra]); break;
      case 0x51: r[ra] = this.pop(); break;
      case 0x60: this.ports.out(a, r[rb]); break;
      case 0x61: r[ra] = this.ports.in(b) & 0xff; break;
      case 0x70: this.sleep = a * 10; break;
    }
    this.cycles++;
    return !this.halted;
  }

  // Runs for `ms` milliseconds of wall time at `hz` instructions per second.
  // Returns the number of instructions executed.
  tick(ms, hz) {
    if (this.halted) return 0;
    let budget = (ms / 1000) * hz;
    let executed = 0;
    const msPerInstr = 1000 / hz;
    while (budget >= 1 && !this.halted) {
      if (this.sleep > 0) {
        this.sleep -= msPerInstr;
        budget -= 1;
        continue;
      }
      this.step();
      budget -= 1;
      executed++;
      if (executed > 100000) break; // safety valve
    }
    // carry the leftover fraction stochastically so slow clocks still progress
    if (budget > 0 && Math.random() < budget && !this.halted) {
      if (this.sleep > 0) this.sleep -= msPerInstr; else { this.step(); executed++; }
    }
    return executed;
  }
}

export function hex(v, w = 2) {
  return v.toString(16).toUpperCase().padStart(w, '0');
}

// ---------------------------------------------------------------- assembler

function parseNumber(tok) {
  const t = tok.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^0b[01]+$/.test(t)) return parseInt(t.slice(2), 2);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^'.'$/.test(tok.trim())) return tok.trim().charCodeAt(1);
  return null;
}

// Splits "a, [b], 'x'" into operands, respecting quotes.
function splitOperands(s) {
  const out = [];
  let cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === ';' || ch === '#') return line.slice(0, i);
  }
  return line;
}

function classify(opnd) {
  const u = opnd.toUpperCase();
  if (REGS.includes(u)) return { kind: 'r', value: REGS.indexOf(u) };
  const m = opnd.match(/^\[(.+)\]$/);
  if (m) {
    const inner = m[1].trim();
    if (REGS.includes(inner.toUpperCase())) return { kind: '[r]', value: REGS.indexOf(inner.toUpperCase()) };
    return { kind: '[adr]', expr: inner };
  }
  return { kind: 'val', expr: opnd };
}

export function assemble(source) {
  const lines = source.split('\n');
  const labels = {};
  const items = [];
  const errors = [];
  let addr = 0;

  // pass 1: sizes and labels
  lines.forEach((raw, i) => {
    let line = stripComment(raw).trim();
    if (!line) return;
    const lm = line.match(/^([A-Za-z_.][\w.]*):\s*(.*)$/);
    if (lm) {
      labels[lm[1].toLowerCase()] = addr;
      line = lm[2].trim();
      if (!line) return;
    }
    const sp = line.search(/\s/);
    const mnem = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
    const rest = sp < 0 ? '' : line.slice(sp + 1);
    const ops = splitOperands(rest);
    if (mnem === 'DB') {
      const bytes = [];
      for (const o of ops) {
        if (/^".*"$/.test(o)) {
          for (const ch of o.slice(1, -1).replace(/\\n/g, '\n')) bytes.push(ch.charCodeAt(0) & 0xff);
        } else bytes.push({ expr: o });
      }
      items.push({ line: i + 1, addr, db: bytes });
      addr += bytes.length;
      return;
    }
    if (mnem === 'ORG') {
      const v = parseNumber(ops[0] || '');
      if (v === null) errors.push(`line ${i + 1}: bad ORG`); else addr = v;
      return;
    }
    const cls = ops.map(classify);
    items.push({ line: i + 1, addr, mnem, cls });
    addr += 1 + cls.length;
  });

  const resolve = (expr, line) => {
    const n = parseNumber(expr);
    if (n !== null) return n & 0xff;
    const key = expr.trim().toLowerCase();
    if (key in labels) return labels[key];
    errors.push(`line ${line}: unknown symbol '${expr}'`);
    return 0;
  };

  // pass 2: encode
  const bin = new Uint8Array(256);
  let size = 0;
  for (const it of items) {
    let bytes;
    if (it.db) {
      bytes = it.db.map((b) => (typeof b === 'number' ? b : resolve(b.expr, it.line)));
    } else {
      const kinds = it.cls.map((c, idx) => {
        if (c.kind !== 'val') return c.kind;
        // a bare value is an address for jumps, an immediate otherwise
        const jumpLike = ['JMP', 'JZ', 'JNZ', 'JC', 'JNC', 'CALL'].includes(it.mnem);
        if (jumpLike) return 'adr';
        if (it.mnem === 'OUT' && idx === 0) return 'imm';
        return 'imm';
      });
      const op = ENCODE[`${it.mnem} ${kinds.join(',')}`];
      if (op === undefined) {
        errors.push(`line ${it.line}: invalid instruction '${it.mnem} ${kinds.join(', ')}'`);
        continue;
      }
      bytes = [op];
      it.cls.forEach((c) => {
        bytes.push(c.expr !== undefined ? resolve(c.expr, it.line) : c.value);
      });
    }
    bytes.forEach((b, k) => {
      const at = it.addr + k;
      if (at > 0xff) { errors.push(`line ${it.line}: program exceeds 256 bytes`); return; }
      bin[at] = b;
      size = Math.max(size, at + 1);
    });
  }
  return { bytes: bin.slice(0, size), labels, errors, size };
}

export function disassemble(mem, start = 0, count = 16) {
  const out = [];
  let pc = start;
  for (let n = 0; n < count && pc < 256; n++) {
    const op = mem[pc];
    const def = OPS[op];
    if (!def) {
      out.push({ addr: pc, bytes: [op], text: `DB 0x${hex(op)}` });
      pc++;
      continue;
    }
    const [m, kinds] = def;
    const args = kinds.map((k, i) => {
      const v = mem[(pc + 1 + i) & 0xff];
      switch (k) {
        case 'r': return REGS[v & 3];
        case '[r]': return `[${REGS[v & 3]}]`;
        case '[adr]': return `[0x${hex(v)}]`;
        case 'adr': return `0x${hex(v)}`;
        default: return `0x${hex(v)}`;
      }
    });
    const len = 1 + kinds.length;
    out.push({ addr: pc, bytes: Array.from(mem.slice(pc, pc + len)), text: `${m} ${args.join(', ')}`.trim() });
    pc += len;
  }
  return out;
}

// ---------------------------------------------------------------- sample programs

export const PROGRAMS = {
  'blink.asm': `; blink.asm - toggle all 8 LEDs on port 0x00
start:
    MOV A, 0xFF
    OUT 0x00, A      ; all LEDs on
    SLP 25           ; sleep 250 ms
    MOV A, 0
    OUT 0x00, A      ; all LEDs off
    SLP 25
    JMP start
`,
  'knight.asm': `; knight.asm - Knight-Rider scanner on the breadboard LEDs
    MOV A, 1
left:
    OUT 0x00, A
    SLP 6
    SHL A
    CMP A, 0x80
    JNZ left
right:
    OUT 0x00, A
    SLP 6
    SHR A
    CMP A, 1
    JNZ right
    JMP left
`,
  'hello.asm': `; hello.asm - print a zero-terminated string via port 0x01
    MOV B, msg       ; B = pointer to string
loop:
    LD A, [B]        ; A = *B
    CMP A, 0
    JZ done
    OUT 0x01, A      ; putchar(A)
    INC B
    JMP loop
done:
    HLT
msg:
    db "Hello from EG-8!\\n", 0
`,
  'fib.asm': `; fib.asm - print Fibonacci numbers below 256 via port 0x02
    MOV A, 0
    MOV B, 1
next:
    OUT 0x02, A      ; print A as a number
    MOV C, A
    ADD C, B         ; C = A + B (sets carry on overflow)
    JC done
    MOV A, B
    MOV B, C
    JMP next
done:
    OUT 0x02, B      ; print the last one (233)
    HLT
`,
  'random.asm': `; random.asm - show bytes from the lava-lamp entropy pool (port 0x10)
loop:
    IN A, 0x10
    OUT 0x00, A
    SLP 10
    JMP loop
`,
  'lamp.asm': `; lamp.asm - cycle the desk lamp hue through port 0x20 (uses a subroutine)
    MOV A, 0
loop:
    CALL show
    ADD A, 4
    JMP loop
show:
    OUT 0x20, A
    PUSH A
    OUT 0x00, A      ; mirror the hue on the LEDs
    POP A
    SLP 3
    RET
`,
};

// A tiny in-memory database for the filing cabinet: a small SQL subset and MongoDB-style find().
//
//   SHOW TABLES
//   DESCRIBE <table>
//   SELECT <*|col, col> FROM <table> [WHERE col op value [AND|OR ...]] [ORDER BY col [ASC|DESC]] [LIMIT n]
//   ops: = != <> < > <= >= LIKE ('%' and '_' wildcards)
//   db.<collection>.find({ key: value, key: { $gt: n } })   ($gt $gte $lt $lte $ne $regex)

export const TABLES = {
  projects: [
    { id: 1, name: 'SecureOS', lang: 'C', status: 'discontinued', kind: 'os' },
    { id: 2, name: 'SecureRustOS', lang: 'Rust', status: 'coming up', kind: 'os' },
    { id: 3, name: 'EngineManager', lang: 'JavaScript', status: 'in progress', kind: 'fullstack' },
    { id: 4, name: 'EngineBuddy', lang: 'Python', status: 'in progress', kind: 'ai' },
    { id: 5, name: "Engine's Antivirus", lang: 'Python', status: 'educational', kind: 'security' },
    { id: 6, name: 'Hybrid-Entropy', lang: 'C++', status: 'research', kind: 'hardware' },
  ],
  languages: [
    { name: 'Rust', paradigm: 'systems', since: 2015, used_for: 'kernel' },
    { name: 'C', paradigm: 'systems', since: 1972, used_for: 'drivers' },
    { name: 'C++', paradigm: 'systems', since: 1985, used_for: 'entropy platform' },
    { name: 'Assembly', paradigm: 'machine', since: 1949, used_for: 'bootloader' },
    { name: 'Python', paradigm: 'scripting', since: 1991, used_for: 'antivirus, AI' },
    { name: 'JavaScript', paradigm: 'scripting', since: 1995, used_for: 'this room' },
    { name: 'Lua', paradigm: 'scripting', since: 1993, used_for: 'game dev' },
  ],
  devices: [
    { host: 'engine-desktop', ip: '10.0.0.2', port: 22, service: 'ssh' },
    { host: 'raspberrypi', ip: '10.0.0.7', port: 1883, service: 'mqtt' },
    { host: 'arduino-eth', ip: '10.0.0.9', port: 80, service: 'http' },
    { host: 'rack-srv01', ip: '10.0.0.20', port: 3306, service: 'mysql' },
    { host: 'rack-srv01', ip: '10.0.0.20', port: 27017, service: 'mongodb' },
    { host: 'enginebuddy', ip: '10.0.0.42', port: 5000, service: 'upnp' },
  ],
  tools: [
    { name: 'Ghidra', category: 'reverse engineering', free: 'yes' },
    { name: 'IDA Pro', category: 'reverse engineering', free: 'no' },
    { name: 'Wireshark', category: 'network', free: 'yes' },
    { name: 'Nmap', category: 'network', free: 'yes' },
    { name: 'QEMU', category: 'emulation', free: 'yes' },
    { name: 'NASM', category: 'assembler', free: 'yes' },
  ],
};

// ------------------------------------------------------------------ SQL

function tokenize(sql) {
  const re = /\s*('(?:[^']|'')*'|"[^"]*"|<=|>=|!=|<>|[=<>(),*]|[A-Za-z_][\w.+]*|-?\d+(?:\.\d+)?)/y;
  const out = [];
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < sql.length) {
    const start = re.lastIndex;
    m = re.exec(sql);
    if (!m) {
      if (sql.slice(start).trim() === '' || sql.slice(start).trim() === ';') break;
      throw new Error(`syntax error near "${sql.slice(start, start + 12).trim()}"`);
    }
    out.push(m[1]);
  }
  return out;
}

function literal(tok) {
  if (/^'.*'$/.test(tok)) return tok.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(tok)) return tok.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
  return { col: tok };
}

function compare(a, op, b) {
  switch (op) {
    case '=': return a == b; // eslint-disable-line eqeqeq
    case '!=': case '<>': return a != b; // eslint-disable-line eqeqeq
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
    case 'LIKE': {
      const re = new RegExp('^' + String(b).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
      return re.test(String(a));
    }
  }
  throw new Error(`unknown operator ${op}`);
}

function getTable(name) {
  const t = TABLES[name?.toLowerCase()];
  if (!t) throw new Error(`table '${name}' does not exist (try SHOW TABLES)`);
  return t;
}

export function runSQL(sql) {
  const tk = tokenize(sql.trim().replace(/;$/, ''));
  const up = (i) => (tk[i] ?? '').toUpperCase();
  if (up(0) === 'SHOW' && up(1) === 'TABLES') return { columns: ['table', 'rows'], rows: Object.entries(TABLES).map(([k, v]) => ({ table: k, rows: v.length })) };
  if (up(0) === 'DESCRIBE' || up(0) === 'DESC') {
    const t = getTable(tk[1]);
    return { columns: ['column', 'type'], rows: Object.keys(t[0]).map((c) => ({ column: c, type: typeof t[0][c] === 'number' ? 'INT' : 'TEXT' })) };
  }
  if (up(0) !== 'SELECT') throw new Error('only SELECT, SHOW TABLES and DESCRIBE are supported (this database is read-only)');
  let i = 1;
  const cols = [];
  while (i < tk.length && up(i) !== 'FROM') { if (tk[i] !== ',') cols.push(tk[i]); i++; }
  if (up(i) !== 'FROM') throw new Error('expected FROM');
  const table = getTable(tk[i + 1]);
  i += 2;
  let rows = table.slice();

  if (up(i) === 'WHERE') {
    i++;
    const conds = []; // [joiner, col, op, value]
    let joiner = 'AND';
    while (i < tk.length && up(i) !== 'ORDER' && up(i) !== 'LIMIT') {
      const col = tk[i], op = up(i + 1), val = literal(tk[i + 2] ?? '');
      if (!op) throw new Error('incomplete WHERE clause');
      conds.push([joiner, col, op, val]);
      i += 3;
      if (up(i) === 'AND' || up(i) === 'OR') { joiner = up(i); i++; }
    }
    rows = rows.filter((r) => {
      let ok = null;
      for (const [j, col, op, val] of conds) {
        if (!(col in r)) throw new Error(`unknown column '${col}'`);
        const v = compare(r[col], op, typeof val === 'object' ? r[val.col] : val);
        ok = ok === null ? v : j === 'AND' ? ok && v : ok || v;
      }
      return ok;
    });
  }
  if (up(i) === 'ORDER' && up(i + 1) === 'BY') {
    const col = tk[i + 2];
    const desc = up(i + 3) === 'DESC';
    i += up(i + 3) === 'DESC' || up(i + 3) === 'ASC' ? 4 : 3;
    rows.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (desc ? -1 : 1));
  }
  if (up(i) === 'LIMIT') rows = rows.slice(0, Number(tk[i + 1]) || 0);

  const columns = cols.length === 1 && cols[0] === '*' ? Object.keys(table[0]) : cols;
  for (const c of columns) if (!(c in table[0])) throw new Error(`unknown column '${c}'`);
  return { columns, rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]]))) };
}

export function formatTable({ columns, rows }) {
  const w = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = '+' + w.map((n) => '-'.repeat(n + 2)).join('+') + '+';
  const fmt = (vals) => '| ' + vals.map((v, k) => String(v).padEnd(w[k])).join(' | ') + ' |';
  return [line, fmt(columns), line, ...rows.map((r) => fmt(columns.map((c) => r[c]))), line, `${rows.length} row(s) in set`];
}

// ------------------------------------------------------------------ MongoDB-style find

function matches(doc, filter) {
  for (const [k, cond] of Object.entries(filter)) {
    const v = doc[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, x] of Object.entries(cond)) {
        if (op === '$gt' && !(v > x)) return false;
        if (op === '$gte' && !(v >= x)) return false;
        if (op === '$lt' && !(v < x)) return false;
        if (op === '$lte' && !(v <= x)) return false;
        if (op === '$ne' && v === x) return false;
        if (op === '$regex' && !new RegExp(x, 'i').test(String(v))) return false;
      }
    } else if (v !== cond) return false;
  }
  return true;
}

export function runMongo(cmd) {
  const m = cmd.trim().match(/^db\.(\w+)\.(find|countDocuments)\((.*)\)\s*;?$/s);
  if (!m) throw new Error('usage: db.<collection>.find({ key: value })   e.g. db.projects.find({lang: "Rust"})');
  const coll = getTable(m[1]);
  let filter = {};
  const body = m[3].trim();
  if (body) {
    // accept relaxed JSON: unquoted keys and single quotes
    const json = body.replace(/'/g, '"').replace(/([{,]\s*)(\$?\w+)\s*:/g, '$1"$2":');
    try { filter = JSON.parse(json); } catch { throw new Error('could not parse the filter document'); }
  }
  const docs = coll.filter((d) => matches(d, filter));
  if (m[2] === 'countDocuments') return [String(docs.length)];
  return docs.map((d) => JSON.stringify(d).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', '));
}

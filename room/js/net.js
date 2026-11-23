// Byte-level packet builder and decoder for the server-rack "packet capture".
// Frames are built as Ethernet II + IPv4 (+ TCP / UDP / ICMP) with a real RFC 1071 checksum,
// then decoded back into a Wireshark-style summary line.

import { hex } from './cpu.js';

export const HOSTS = [
  { name: 'engine-desktop', ip: [10, 0, 0, 2], mac: [0x02, 0x45, 0x47, 0x00, 0x00, 0x02], ports: [22, 8080] },
  { name: 'raspberrypi', ip: [10, 0, 0, 7], mac: [0xb8, 0x27, 0xeb, 0x12, 0x34, 0x56], ports: [22, 1883] },
  { name: 'arduino-eth', ip: [10, 0, 0, 9], mac: [0x90, 0xa2, 0xda, 0x0f, 0x00, 0x09], ports: [80] },
  { name: 'rack-srv01', ip: [10, 0, 0, 20], mac: [0x02, 0x52, 0x41, 0x43, 0x4b, 0x01], ports: [22, 53, 443, 27017, 3306] },
  { name: 'enginebuddy', ip: [10, 0, 0, 42], mac: [0x02, 0x42, 0x55, 0x44, 0x44, 0x59], ports: [5000] },
  { name: 'gateway', ip: [10, 0, 0, 1], mac: [0x02, 0x00, 0x00, 0x00, 0x00, 0x01], ports: [53, 80] },
];

const SERVICES = { 22: 'ssh', 53: 'domain', 80: 'http', 443: 'https', 1883: 'mqtt', 3306: 'mysql', 5000: 'upnp', 8080: 'http-alt', 27017: 'mongodb' };

// RFC 1071 internet checksum over a byte array
export function checksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    sum += (bytes[i] << 8) | (bytes[i + 1] ?? 0);
  }
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

const u16 = (v) => [(v >> 8) & 0xff, v & 0xff];
const u32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

let ipId = 0x1c46;

function ipv4(src, dst, proto, payload) {
  const totalLen = 20 + payload.length;
  const h = [
    0x45, 0x00, ...u16(totalLen),
    ...u16(ipId++ & 0xffff), 0x40, 0x00, // flags: DF
    64, proto, 0x00, 0x00,               // TTL, protocol, checksum placeholder
    ...src, ...dst,
  ];
  const c = checksum(h);
  h[10] = c >> 8; h[11] = c & 0xff;
  return [...h, ...payload];
}

function ethernet(srcMac, dstMac, type, payload) {
  return [...dstMac, ...srcMac, ...u16(type), ...payload];
}

function tcp(sport, dport, flags, seq, ack, data = []) {
  return [...u16(sport), ...u16(dport), ...u32(seq), ...u32(ack), 0x50, flags, ...u16(64240), 0x00, 0x00, 0x00, 0x00, ...data];
}

function udp(sport, dport, data) {
  return [...u16(sport), ...u16(dport), ...u16(8 + data.length), 0x00, 0x00, ...data];
}

function dnsQuery(name) {
  const q = [...u16(rnd(0xffff)), 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  for (const label of name.split('.')) q.push(label.length, ...[...label].map((c) => c.charCodeAt(0)));
  q.push(0, 0x00, 0x01, 0x00, 0x01);
  return q;
}

const DOMAINS = ['github.com', 'crates.io', 'docs.rs', 'osdev.org', 'wiki.osdev.org', 'pypi.org', 'kernel.org'];

export function randomFrame() {
  const a = pick(HOSTS);
  let b = pick(HOSTS);
  while (b === a) b = pick(HOSTS);
  const kind = rnd(10);
  if (kind < 2) {
    // ARP request
    const arp = [0x00, 0x01, 0x08, 0x00, 6, 4, 0x00, 0x01, ...a.mac, ...a.ip, 0, 0, 0, 0, 0, 0, ...b.ip];
    return ethernet(a.mac, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 0x0806, arp);
  }
  if (kind < 4) {
    const gw = HOSTS[5];
    const src = a === gw ? b : a;
    return ethernet(src.mac, gw.mac, 0x0800, ipv4(src.ip, gw.ip, 17, udp(40000 + rnd(20000), 53, dnsQuery(pick(DOMAINS)))));
  }
  if (kind < 5) {
    // ICMP echo request with a tiny payload
    const icmp = [8, 0, 0, 0, ...u16(0x1337), ...u16(rnd(100)), ...[...'EG-8ping'].map((c) => c.charCodeAt(0))];
    const c = checksum(icmp);
    icmp[2] = c >> 8; icmp[3] = c & 0xff;
    return ethernet(a.mac, b.mac, 0x0800, ipv4(a.ip, b.ip, 1, icmp));
  }
  const dport = pick(b.ports);
  const flags = pick([0x02, 0x12, 0x10, 0x18, 0x18, 0x11]);
  const data = flags === 0x18 ? [...'GET / HTTP/1.1\r\n'].map((c) => c.charCodeAt(0)).slice(0, 8 + rnd(8)) : [];
  return ethernet(a.mac, b.mac, 0x0800, ipv4(a.ip, b.ip, 6, tcp(49152 + rnd(16000), dport, flags, rnd(2 ** 31), rnd(2 ** 31), data)));
}

// CTF: a login over plain HTTP. The password is a flag, readable in the hexdump.
export const PCAP_FLAG = 'flag{sn1ff3d_th3_w1r3}';
export function loginFrame() {
  const a = HOSTS[0], b = HOSTS[3];
  const body = `POST /login HTTP/1.1\r\nHost: rack-srv01\r\n\r\nuser=engine&pass=${PCAP_FLAG}`;
  const data = [...body].map((c) => c.charCodeAt(0));
  return ethernet(a.mac, b.mac, 0x0800, ipv4(a.ip, b.ip, 6, tcp(51515, 80, 0x18, 0x1000, 0x2000, data)));
}

const ip = (b, o) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
const r16 = (b, o) => (b[o] << 8) | b[o + 1];

function tcpFlags(f) {
  const n = [];
  if (f & 0x02) n.push('SYN');
  if (f & 0x10) n.push('ACK');
  if (f & 0x08) n.push('PSH');
  if (f & 0x01) n.push('FIN');
  if (f & 0x04) n.push('RST');
  return n.join(',');
}

// Decodes a raw frame into a summary {proto, src, dst, info, ok}
export function decode(f) {
  const type = r16(f, 12);
  if (type === 0x0806) {
    return { proto: 'ARP', src: hostName(f.slice(28, 32)), dst: 'broadcast', info: `Who has ${ip(f, 38)}? Tell ${ip(f, 28)}`, ok: true };
  }
  const ihl = (f[14] & 0x0f) * 4;
  const hdr = f.slice(14, 14 + ihl);
  const ok = checksum(hdr) === 0; // a valid header sums to 0
  const proto = f[23];
  const src = ip(f, 26), dst = ip(f, 30);
  const p = 14 + ihl;
  if (proto === 1) return { proto: 'ICMP', src, dst, info: `Echo (ping) request id=0x${hex(r16(f, p + 4), 4)} seq=${r16(f, p + 6)}`, ok };
  if (proto === 17) {
    let name = [], o = p + 8 + 12;
    while (f[o]) { const len = f[o]; name.push(String.fromCharCode(...f.slice(o + 1, o + 1 + len))); o += len + 1; }
    return { proto: 'DNS', src, dst, info: `Standard query A ${name.join('.')}`, ok };
  }
  const sp = r16(f, p), dp = r16(f, p + 2);
  const flags = tcpFlags(f[p + 13]);
  const payload = f.slice(p + 20);
  if (payload.length >= 4 && String.fromCharCode(...payload.slice(0, 4)) === 'POST') {
    return { proto: 'HTTP', src, dst, info: 'POST /login HTTP/1.1  (credentials in clear text!)', ok, login: true };
  }
  const svc = SERVICES[dp] ?? dp;
  return { proto: 'TCP', src, dst, info: `${sp} → ${dp} (${svc}) [${flags}] Win=${r16(f, p + 14)}`, ok };
}

function hostName(ipBytes) {
  const h = HOSTS.find((x) => x.ip.every((v, i) => v === ipBytes[i]));
  return h ? h.name : ip(ipBytes, 0);
}

export function hexdump(bytes, max = 64) {
  const lines = [];
  for (let o = 0; o < Math.min(bytes.length, max); o += 16) {
    const chunk = Array.from(bytes.slice(o, o + 16));
    const h = chunk.map((b) => hex(b)).join(' ').padEnd(47, ' ');
    const a = chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${hex(o, 4)}  ${h}  ${a}`);
  }
  return lines;
}

export function nmap() {
  const lines = ['Starting Nmap-ish 0.1 ( engine-room ) scan of 10.0.0.0/24'];
  for (const h of HOSTS) {
    lines.push(`Nmap scan report for ${h.name} (${h.ip.join('.')})`);
    lines.push(`MAC: ${h.mac.map((b) => hex(b)).join(':')}`);
    for (const port of h.ports) lines.push(`  ${String(port + '/tcp').padEnd(10)} open  ${SERVICES[port] ?? 'unknown'}`);
  }
  lines.push(`Nmap done: 256 IP addresses (${HOSTS.length} hosts up)`);
  return lines;
}

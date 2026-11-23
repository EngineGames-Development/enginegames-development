// Extra room objects that match the owner's interests:
// RE laptop + crackme, electronics bench (oscilloscope + robot arm), build PC, arcade cabinet,
// project corkboard, database filing cabinet, memory-map whiteboard, Wireshark shark, Nmap telescope, Tux plush.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { disassemble, hex, assemble, CRACKME_SRC } from './cpu.js';
import { PacketCatcher } from './arcade.js';
import { crtMaterial } from './shaders.js';
import { runSQL } from './db.js';
import { HOSTS } from './net.js';

export function buildExtras(k) {
  const { scene, C, mat, glow, basic, box, cyl, ball, sign, canvasTexture, interact, collide, animated, showInfo, terminal, cpu, deskTopY, noOutline, camera, sfx, emit } = k;
  const api = {};
  const ink = mat(C.ink);

  // ================================================================ RE laptop (Ghidra-style crackme)
  const laptop = new THREE.Group();
  laptop.position.set(-0.68, deskTopY, -3.2);
  laptop.rotation.y = 0.38;
  scene.add(laptop);
  const laptopGrey = mat(0x5a6080);
  box(0.38, 0.02, 0.26, laptopGrey, 0, 0.01, 0, laptop, 0.008);
  box(0.32, 0.004, 0.14, mat(0x2f3348, { outline: false }), 0, 0.021, -0.02, laptop, 0.001);
  box(0.1, 0.003, 0.06, mat(0x4a5070, { outline: false }), 0, 0.021, 0.085, laptop, 0.001);
  const lid = new THREE.Group();
  lid.position.set(0, 0.02, -0.125);
  lid.rotation.x = -0.28;
  laptop.add(lid);
  box(0.38, 0.25, 0.012, laptopGrey, 0, 0.125, 0, lid, 0.006);
  const reCanvas = document.createElement('canvas');
  reCanvas.width = 1024; reCanvas.height = 660;
  const reTex = new THREE.CanvasTexture(reCanvas);
  reTex.colorSpace = THREE.SRGBColorSpace;
  reTex.anisotropy = 8;
  const reScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.225), new THREE.MeshBasicMaterial({ map: reTex }));
  reScreen.material.userData = { ...noOutline };
  reScreen.position.set(0, 0.125, 0.0065);
  lid.add(reScreen);
  // stickers on the back of the lid
  [[C.red, -0.1, 0.17], [C.yellow, 0.08, 0.08], [C.green, 0.11, 0.19], [C.purple, -0.06, 0.06]].forEach(([col, x, y]) => {
    const st = cyl(0.03, 0.03, 0.003, mat(col, { outline: false }), x, y, -0.008, lid, 16);
    st.rotation.x = Math.PI / 2;
  });
  let cracked = false;
  function drawRE() {
    const g = reCanvas.getContext('2d');
    const W = reCanvas.width, H = reCanvas.height;
    g.fillStyle = '#fff8ea'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#4a7fe0'; g.fillRect(0, 0, W, 40);
    g.fillStyle = '#fff'; g.font = 'bold 22px "Fredoka", sans-serif'; g.textBaseline = 'middle';
    g.fillText('CodeBrowser: crackme.bin  (EG-8, little endian)', 16, 21);
    // listing
    g.fillStyle = '#e9e1cf'; g.fillRect(0, 40, 560, 26); g.fillRect(564, 40, W - 564, 26);
    g.fillStyle = '#2b2340'; g.font = 'bold 18px "Fredoka", sans-serif';
    g.fillText('Listing', 12, 53); g.fillText('Decompile: check(char *input)', 576, 53);
    g.fillStyle = '#c9bfa8'; g.fillRect(560, 40, 4, H);
    const asmRes = assemble(CRACKME_SRC);
    const bytes = asmRes.bytes;
    const L = asmRes.labels;
    const labels = { 0: 'check', [L.loop]: 'LAB_loop', [L.endcheck]: 'LAB_end', [L.fail]: 'LAB_fail', [L.print]: 'LAB_print', [L.done]: 'LAB_done' };
    const tableAt = L.table;
    g.font = '16px "DejaVu Sans Mono", Consolas, monospace';
    let y = 84;
    for (const d of disassemble(bytes, 0, 40)) {
      if (d.addr >= tableAt) break;
      if (y > H - 110) break;
      if (labels[d.addr]) { g.fillStyle = '#8a62e8'; g.fillText(labels[d.addr] + ':', 12, y); y += 20; }
      g.fillStyle = '#6b7290'; g.fillText(hex(d.addr), 12, y);
      g.fillStyle = '#9a5a2e'; g.fillText(d.bytes.map((b) => hex(b)).join(' '), 52, y);
      g.fillStyle = '#2b2340'; g.fillText(d.text, 180, y);
      y += 20;
    }
    g.fillStyle = '#8a62e8'; g.fillText('DAT_table:', 12, y); y += 20;
    g.fillStyle = '#ef5a5a'; g.fillText(`${hex(tableAt)}  ${Array.from(bytes.slice(tableAt, tableAt + 6)).map((b) => hex(b)).join(' ')}   db ...`, 12, y); y += 20;
    g.fillStyle = '#8a62e8'; g.fillText('s_ACCESS_GRANTED, s_ACCESS_DENIED', 12, y);
    // decompiled C
    const code = [
      ['#8a62e8', 'bool check(char *input)'],
      ['#2b2340', '{'],
      ['#2b2340', '  int i;'],
      ['#2b2340', '  for (i = 0; DAT_table[i] != 0; i++) {'],
      ['#2b2340', '    if ((input[i] ^ 0x5A) != DAT_table[i])'],
      ['#ef5a5a', '      return puts("ACCESS DENIED");'],
      ['#2b2340', '  }'],
      ['#2b2340', '  if (input[i] != 0)'],
      ['#ef5a5a', '    return puts("ACCESS DENIED");'],
      ['#2fa86a', '  return puts("ACCESS GRANTED");'],
      ['#2b2340', '}'],
      ['#6b7290', ''],
      ['#6b7290', '// input is read from 0xC0'],
      ['#6b7290', `// DAT_table @ 0x${hex(tableAt)} = ${Array.from(bytes.slice(tableAt, tableAt + 5)).map((b) => hex(b)).join(' ')}`],
      ['#6b7290', '// hint: x ^ k ^ k == x'],
      ['#6b7290', '// verify: crackme <password>'],
    ];
    g.font = '18px "DejaVu Sans Mono", Consolas, monospace';
    code.forEach(([col, line], i) => { g.fillStyle = col; g.fillText(line, 578, 90 + i * 26); });
    if (cracked) {
      g.save(); g.translate(W * 0.72, H * 0.8); g.rotate(-0.15);
      g.strokeStyle = '#2fa86a'; g.lineWidth = 8; g.strokeRect(-170, -45, 340, 90);
      g.fillStyle = '#2fa86a'; g.font = 'bold 56px "Fredoka", sans-serif'; g.textAlign = 'center';
      g.fillText('CRACKED!', 0, 4);
      g.restore();
    }
    reTex.needsUpdate = true;
  }
  drawRE();
  api.laptopFocus = { screen: reScreen, w: 0.35, h: 0.225, hint: 'Reading the disassembly · <b>Esc</b> to stand up · solve it in the terminal with <code>crackme &lt;password&gt;</code>' };
  interact(laptop, '[E] RE laptop: crackme.bin in a Ghidra-style view', () => {
    k.enterFocus(api.laptopFocus);
    showInfo('Reverse engineering', 'A crackme for the EG-8 CPU. Read the listing and decompiled code, work out the password, then test it in the terminal: <code>crackme &lt;password&gt;</code>. Also try <code>strings ~/re/crackme.bin</code>.', 9000);
  });

  // confetti for a solved crackme
  const confetti = [];
  function burst(pos) {
    const cols = [C.red, C.yellow, C.green, C.blue, C.pink, C.purple];
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 0.04), basic(cols[i % cols.length], { side: THREE.DoubleSide }));
      m.position.copy(pos);
      m.userData.noHit = true;
      scene.add(m);
      confetti.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 2.4, 1.6 + Math.random() * 2.2, (Math.random() - 0.5) * 2.4), life: 3 + Math.random() });
    }
  }
  animated.push((t, dt) => {
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.v.y -= 4 * dt;
      c.v.multiplyScalar(1 - dt * 0.8);
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += dt * 8; c.m.rotation.y += dt * 5;
      if (c.m.position.y < 0.01) { c.m.position.y = 0.01; c.v.set(0, 0, 0); }
      if ((c.life -= dt) <= 0) { scene.remove(c.m); confetti.splice(i, 1); }
    }
  });
  api.burst = burst;
  api.onCracked = () => {
    cracked = true;
    emit('crack');
    sfx.fanfare();
    drawRE();
    const p = new THREE.Vector3();
    reScreen.getWorldPosition(p);
    burst(p.add(new THREE.Vector3(0, 0.15, 0.1)));
    showInfo('Cracked!', 'The password was XOR-encoded with <code>0x5A</code>. Nice reversing! The laptop got a stamp.', 8000);
  };

  // ================================================================ build PC under the desk
  const pc = new THREE.Group();
  pc.position.set(2.04, 0, -3.5);
  scene.add(pc);
  box(0.26, 0.56, 0.5, mat(0x3b3363), 0, 0.3, 0, pc, 0.03);
  for (const [x, z] of [[-0.09, -0.2], [0.09, -0.2], [-0.09, 0.2], [0.09, 0.2]]) ball(0.02, ink, x, 0.015, z, pc, 8);
  const pcGlass = new THREE.MeshToonMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.25, gradientMap: k.gradientMap, depthWrite: false });
  pcGlass.userData = { ...noOutline };
  const glassPanel = box(0.2, 0.46, 0.01, pcGlass, 0, 0.32, 0.252, pc, 0.004);
  glassPanel.castShadow = false;
  const fans = [];
  const fanRimMats = [];
  for (let i = 0; i < 3; i++) {
    const fanG = new THREE.Group();
    fanG.position.set(0, 0.17 + i * 0.14, 0.23);
    pc.add(fanG);
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    rimMat.userData = { ...noOutline };
    fanRimMats.push(rimMat);
    fanG.add(new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.008, 8, 24), rimMat));
    const blades = new THREE.Group();
    fanG.add(blades);
    for (let b = 0; b < 5; b++) {
      const bl = box(0.045, 0.018, 0.004, mat(0x22203a, { outline: false }), 0, 0, 0, blades, 0.002);
      bl.position.set(Math.cos((b / 5) * Math.PI * 2) * 0.026, Math.sin((b / 5) * Math.PI * 2) * 0.026, 0);
      bl.rotation.z = (b / 5) * Math.PI * 2 + 0.6;
    }
    ball(0.013, mat(0x22203a, { outline: false }), 0, 0, 0.004, fanG, 8);
    fans.push(blades);
  }
  ball(0.012, glow(0x55ff88, 1), 0.08, 0.52, 0.252, pc, 8);
  collide(1.9, 2.18, -3.76, -3.24);
  let building = false;
  api.setBuilding = (b) => { building = b; };
  animated.push((t, dt) => {
    fans.forEach((f, i) => { f.rotation.z -= dt * (building ? 40 : 9) * (1 + i * 0.1); });
    fanRimMats.forEach((m, i) => m.color.setHSL(building ? 0.0 : (t * 0.15 + i * 0.12) % 1, 0.9, building ? 0.5 + 0.2 * Math.sin(t * 20) : 0.6));
  });
  interact(pc, '[E] Build PC: make run (compile + boot SecureRustOS)', () => {
    terminal.submit('make run');
    showInfo('Build PC', 'Running <code>make run</code>: NASM assembles the bootloader, cargo builds the Rust kernel, ld links it and "QEMU" boots it. Watch the CRT and the fans!');
  });

  // ================================================================ electronics bench: oscilloscope + robot arm
  const bench = new THREE.Group();
  bench.position.set(3.1, 0, -3.58);
  scene.add(bench);
  const benchTop = 0.8;
  box(1.55, 0.06, 0.72, mat(0x6fa8a0), 0, benchTop - 0.03, 0, bench, 0.025);
  for (const [x, z] of [[-0.72, -0.3], [0.72, -0.3], [-0.72, 0.3], [0.72, 0.3]]) box(0.05, benchTop - 0.06, 0.05, mat(C.grey), x, (benchTop - 0.06) / 2, z, bench, 0.015);
  box(1.45, 0.03, 0.62, mat(0x5a8f88), 0, 0.2, 0, bench, 0.012); // lower shelf
  box(0.3, 0.16, 0.22, mat(C.yellow), -0.4, 0.3, 0, bench, 0.02);  // parts box
  collide(2.3, 3.9, -3.98, -3.2);

  // oscilloscope sampling EG-8 port 0x00
  const scope = new THREE.Group();
  scope.position.set(2.55, benchTop, -3.66);
  scope.rotation.y = 0.15;
  scene.add(scope);
  box(0.46, 0.3, 0.3, mat(0xe8e2d0), 0, 0.15, 0, scope, 0.03);
  box(0.3, 0.22, 0.01, mat(0x2b2340), -0.06, 0.16, 0.15, scope, 0.008);
  const scopeCanvas = document.createElement('canvas');
  scopeCanvas.width = 512; scopeCanvas.height = 380;
  const scopeTex = new THREE.CanvasTexture(scopeCanvas);
  scopeTex.colorSpace = THREE.SRGBColorSpace;
  const scopeScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.2), new THREE.MeshBasicMaterial({ map: scopeTex }));
  scopeScreen.material.userData = { ...noOutline };
  scopeScreen.position.set(-0.06, 0.16, 0.157);
  scope.add(scopeScreen);
  [[0.15, 0.24, C.red], [0.15, 0.16, C.blue], [0.15, 0.08, C.yellow], [0.2, 0.24, C.grey], [0.2, 0.16, C.grey]].forEach(([x, y, col]) => {
    const kn = cyl(0.017, 0.017, 0.02, mat(col), x, y, 0.155, scope, 14);
    kn.rotation.x = Math.PI / 2;
  });
  // probe cable to the robot arm
  const probe = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.2, 0.05, 0.12), new THREE.Vector3(0.35, 0.01, 0.25), new THREE.Vector3(0.6, 0.01, 0.2), new THREE.Vector3(0.82, 0.03, 0.12),
  ]), 20, 0.007, 6), mat(C.red));
  scope.add(probe);
  const SAMPLES = 160;
  const history = new Uint8Array(SAMPLES);
  let sampleAcc = 0, scopeHead = 0;
  function drawScope() {
    const g = scopeCanvas.getContext('2d');
    const W = scopeCanvas.width, H = scopeCanvas.height;
    g.fillStyle = '#0e2a22'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1d4a3c'; g.lineWidth = 2;
    for (let x = 0; x <= W; x += W / 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += H / 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const colors = ['#ff6b8a', '#ff6b8a', '#ffc23c', '#ffc23c', '#5dff8a', '#5dff8a', '#6fd3ff', '#6fd3ff'];
    const laneH = (H - 40) / 8;
    for (let ch = 0; ch < 8; ch++) {
      const base = 30 + (7 - ch) * laneH + laneH * 0.8;
      g.strokeStyle = colors[ch]; g.lineWidth = 4; g.shadowColor = colors[ch]; g.shadowBlur = 8;
      g.beginPath();
      for (let i = 0; i < SAMPLES; i++) {
        const v = (history[(scopeHead + i) % SAMPLES] >> ch) & 1;
        const x = 40 + (i / (SAMPLES - 1)) * (W - 50);
        const y = base - v * laneH * 0.6;
        if (i === 0) g.moveTo(x, y);
        else {
          const prev = (history[(scopeHead + i - 1) % SAMPLES] >> ch) & 1;
          if (prev !== v) g.lineTo(x, base - prev * laneH * 0.6);
          g.lineTo(x, y);
        }
      }
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = colors[ch]; g.font = 'bold 18px "Fredoka", sans-serif'; g.textBaseline = 'middle';
      g.fillText(`D${ch}`, 6, base - laneH * 0.3);
    }
    g.fillStyle = '#c8f7d4'; g.font = 'bold 20px "DejaVu Sans Mono", monospace';
    g.fillText(`port 0x00 = 0x${hex(k.getLeds())}   20 ms/div`, 12, 16);
    scopeTex.needsUpdate = true;
  }
  animated.push((t, dt) => {
    sampleAcc += dt;
    let changed = false;
    while (sampleAcc >= 0.02) {
      sampleAcc -= 0.02;
      history[scopeHead] = k.getLeds();
      scopeHead = (scopeHead + 1) % SAMPLES;
      changed = true;
    }
    if (changed && camera.position.distanceTo(scope.position) < 6) drawScope();
  });
  drawScope();
  interact(scope, 'Oscilloscope: live logic trace of port 0x00', () =>
    showInfo('Oscilloscope', 'An 8-channel logic trace of EG-8 port <code>0x00</code>, sampled every 20 ms. <code>run blink.asm</code> gives square waves, <code>run knight.asm</code> a staircase, <code>run random.asm</code> noise.'));

  // robot arm on ports 0x30 (base), 0x31 (shoulder), 0x32 (claw)
  const arm = new THREE.Group();
  arm.position.set(3.62, benchTop, -3.74);
  scene.add(arm);
  const armYellow = mat(C.yellow), armJoint = mat(C.ink);
  cyl(0.11, 0.13, 0.05, mat(C.grey), 0, 0.025, 0, arm, 28);
  const turret = new THREE.Group();
  turret.position.y = 0.05;
  arm.add(turret);
  cyl(0.07, 0.08, 0.08, armYellow, 0, 0.04, 0, turret, 24);
  const shoulder = new THREE.Group();
  shoulder.position.y = 0.1;
  turret.add(shoulder);
  const sj = cyl(0.04, 0.04, 0.1, armJoint, 0, 0, 0, shoulder, 18);
  sj.rotation.z = Math.PI / 2;
  box(0.06, 0.26, 0.06, armYellow, 0, 0.13, 0, shoulder, 0.02);
  const elbow = new THREE.Group();
  elbow.position.y = 0.26;
  elbow.rotation.x = 1.1;
  shoulder.add(elbow);
  const ej = cyl(0.033, 0.033, 0.08, armJoint, 0, 0, 0, elbow, 16);
  ej.rotation.z = Math.PI / 2;
  box(0.05, 0.2, 0.05, armYellow, 0, 0.1, 0, elbow, 0.018);
  const wrist = new THREE.Group();
  wrist.position.y = 0.21;
  elbow.add(wrist);
  ball(0.03, armJoint, 0, 0, 0, wrist, 12);
  const fingers = [-1, 1].map((side) => {
    const f = new THREE.Group();
    f.position.set(side * 0.02, 0.02, 0);
    wrist.add(f);
    box(0.014, 0.07, 0.03, mat(C.red), 0, 0.035, 0, f, 0.006);
    return { f, side };
  });
  const armTarget = { base: 128, shoulder: 100, claw: 0 }, armNow = { ...armTarget };
  api.setArmPort = (port, v) => {
    if (port === 0x30) armTarget.base = v;
    else if (port === 0x31) armTarget.shoulder = v;
    else if (port === 0x32) armTarget.claw = v;
  };
  api.setArm = (b, s, c) => { armTarget.base = b; armTarget.shoulder = s; armTarget.claw = c; };
  animated.push((t, dt) => {
    for (const key of ['base', 'shoulder', 'claw']) armNow[key] += (armTarget[key] - armNow[key]) * Math.min(1, dt * 6);
    turret.rotation.y = (armNow.base / 255 - 0.5) * 2.6;
    shoulder.rotation.x = 0.9 - (armNow.shoulder / 255) * 1.4;
    for (const { f, side } of fingers) f.rotation.z = side * -(0.05 + (armNow.claw / 255) * 0.6);
  });
  interact(arm, '[E] Robot arm: run arm.asm (ports 0x30-0x32)', () => {
    terminal.loadProgram('arm.asm');
    cpu.halted = false;
    terminal.print('[bench] running arm.asm: OUT 0x30 = base, 0x31 = shoulder, 0x32 = claw', '#5ad1ff');
    showInfo('Robot arm', 'Servos are wired to EG-8 ports <code>0x30</code> (base), <code>0x31</code> (shoulder) and <code>0x32</code> (claw). Running <code>arm.asm</code>. Manual control: <code>arm 200 150 255</code>.');
  });

  // soldering station: heats up, then solder the board joint by joint
  const solder = new THREE.Group();
  solder.position.set(3.02, benchTop, -3.36);
  scene.add(solder);
  const station = new THREE.Group();
  station.position.set(-0.1, 0, 0.02);
  solder.add(station);
  box(0.2, 0.11, 0.16, mat(C.red), 0, 0.055, 0, station, 0.02);
  const lcdCanvas = document.createElement('canvas');
  lcdCanvas.width = 256; lcdCanvas.height = 112;
  const lcdTex = new THREE.CanvasTexture(lcdCanvas);
  lcdTex.colorSpace = THREE.SRGBColorSpace;
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.044), new THREE.MeshBasicMaterial({ map: lcdTex }));
  lcd.material.userData = { ...noOutline };
  lcd.position.set(-0.03, 0.07, 0.081);
  station.add(lcd);
  const knob = cyl(0.02, 0.02, 0.02, mat(C.ink), 0.06, 0.06, 0.085, station, 16);
  knob.rotation.x = Math.PI / 2;
  const powerLed = ball(0.007, glow(0x333333, 1), 0.06, 0.025, 0.081, station, 8);
  // holder spiral + iron
  const holder = new THREE.Group();
  holder.position.set(0.1, 0, 0.0);
  solder.add(holder);
  cyl(0.035, 0.04, 0.02, mat(C.ink), 0, 0.01, 0, holder, 16);
  const sponge = box(0.05, 0.012, 0.05, mat(C.yellow), 0, 0.025, 0, holder, 0.004);
  sponge.castShadow = false;
  const coil = new THREE.Mesh(new THREE.TorusKnotGeometry(0.018, 0.0035, 48, 6, 1, 6), mat(0xd8dde8));
  coil.position.set(0, 0.06, 0);
  coil.scale.set(1, 2.2, 1);
  holder.add(coil);
  const iron = new THREE.Group();
  iron.position.set(0, 0.06, 0);
  iron.rotation.set(0.5, 0, -0.55);
  holder.add(iron);
  cyl(0.011, 0.011, 0.1, mat(C.blue), 0, 0.06, 0, iron, 12);   // grip
  cyl(0.004, 0.006, 0.05, mat(0xb8bcc8), 0, -0.015, 0, iron, 10); // shaft
  const tipMat = new THREE.MeshToonMaterial({ color: 0x8a8f9e, emissive: 0xff5a1a, emissiveIntensity: 0, gradientMap: k.gradientMap });
  const tip = cyl(0.0005, 0.004, 0.025, tipMat, 0, -0.05, 0, iron, 8);
  // cable from the iron to the station
  const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.06, 0.13, 0.02), new THREE.Vector3(0.05, 0.06, 0.09), new THREE.Vector3(-0.02, 0.01, 0.1), new THREE.Vector3(-0.1, 0.04, 0.08),
  ]), 16, 0.004, 6), mat(C.ink, { outline: false }));
  solder.add(cable);
  // helping hands with a magnifier and a PCB
  const hands = new THREE.Group();
  hands.position.set(0.32, 0, 0.05);
  hands.rotation.y = -0.5;
  solder.add(hands);
  box(0.12, 0.02, 0.08, mat(C.ink), 0, 0.01, 0, hands, 0.006);
  cyl(0.006, 0.006, 0.14, mat(0xb8bcc8), 0, 0.08, 0, hands, 8);
  for (const side of [-1, 1]) {
    const armH = cyl(0.004, 0.004, 0.1, mat(0xb8bcc8), side * 0.04, 0.15, 0, hands, 6);
    armH.rotation.z = side * 1.1;
    ball(0.01, mat(C.red), side * 0.085, 0.13, 0, hands, 8);
  }
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 8, 24), mat(C.ink));
  lensRing.position.set(0, 0.2, 0.04);
  lensRing.rotation.x = -0.4;
  hands.add(lensRing);
  const lensGlass = new THREE.MeshToonMaterial({ color: 0xcfefff, transparent: true, opacity: 0.35, gradientMap: k.gradientMap, depthWrite: false });
  lensGlass.userData = { ...noOutline };
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 24), lensGlass);
  lens.position.copy(lensRing.position);
  lens.rotation.x = -0.4;
  lens.userData.noHit = true;
  hands.add(lens);
  const pcb = new THREE.Group();
  pcb.position.set(0, 0.13, 0);
  pcb.rotation.x = -0.25;
  hands.add(pcb);
  box(0.15, 0.06, 0.006, mat(0x2e9e4f), 0, 0, 0, pcb, 0.002);
  box(0.03, 0.02, 0.008, mat(C.ink), -0.035, 0.008, 0.005, pcb, 0.002); // chip
  const boardLedMat = new THREE.MeshToonMaterial({ color: 0x2a5a33, emissive: 0x44ff66, emissiveIntensity: 0, gradientMap: k.gradientMap });
  ball(0.007, boardLedMat, 0.055, 0.015, 0.006, pcb, 8);
  const JOINTS = 8;
  const jointMats = [];
  for (let i = 0; i < JOINTS; i++) {
    const jm = new THREE.MeshToonMaterial({ color: 0xc58a3a, gradientMap: k.gradientMap }); // bare copper pad
    jointMats.push(jm);
    const j = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.008, 10), jm);
    j.rotation.x = Math.PI / 2;
    j.position.set(-0.06 + (i % 4) * 0.025, i < 4 ? -0.018 : 0.02, 0.006);
    pcb.add(j);
  }
  // fumes
  const fumeMat = new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, gradientMap: k.gradientMap });
  fumeMat.userData = { ...noOutline };
  const fumes = [];
  function puff(at) {
    for (let i = 0; i < 6; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), fumeMat);
      f.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.02));
      f.userData.noHit = true;
      scene.add(f);
      fumes.push({ f, life: 1.4 + Math.random() * 0.6, v: 0.08 + Math.random() * 0.05, ph: Math.random() * 6 });
    }
  }
  const sol = { on: false, temp: 24, joints: 0 };
  function drawLcd() {
    const g = lcdCanvas.getContext('2d');
    g.fillStyle = sol.on ? '#bff5c8' : '#5a6a5c'; g.fillRect(0, 0, 256, 112);
    g.fillStyle = '#1b2a1e'; g.textAlign = 'right'; g.textBaseline = 'middle';
    g.font = 'bold 72px "DejaVu Sans Mono", monospace';
    g.fillText(`${Math.round(sol.temp)}`, 190, 60);
    g.font = 'bold 34px "DejaVu Sans Mono", monospace';
    g.fillText('°C', 248, 42);
    g.font = 'bold 20px "Fredoka", sans-serif'; g.textAlign = 'left';
    g.fillText(sol.on ? (sol.temp > 340 ? 'READY' : 'HEAT') : 'OFF', 10, 96);
    lcdTex.needsUpdate = true;
  }
  drawLcd();
  function setSolder(on) {
    sol.on = on;
    powerLed.material.emissive.set(on ? 0x55ff66 : 0x333333);
    return sol;
  }
  api.solder = (cmd) => {
    if (cmd === 'on' || cmd === 'off') setSolder(cmd === 'on');
    return { ...sol };
  };
  let lcdAcc = 0;
  animated.push((t, dt) => {
    const target = sol.on ? 350 : 24;
    sol.temp += (target - sol.temp) * Math.min(1, dt * (sol.on ? 0.9 : 0.25));
    if (Math.abs(target - sol.temp) < 0.5) sol.temp = target;
    tipMat.emissiveIntensity = Math.max(0, (sol.temp - 150) / 200);
    knob.rotation.y = (sol.on ? 1.2 : 0);
    if ((lcdAcc += dt) > 0.15) { lcdAcc = 0; drawLcd(); }
    for (let i = fumes.length - 1; i >= 0; i--) {
      const fm = fumes[i];
      fm.f.position.y += fm.v * dt;
      fm.f.position.x += Math.sin(t * 3 + fm.ph) * 0.01 * dt;
      fm.f.scale.setScalar(1 + (2 - fm.life) * 1.2);
      if ((fm.life -= dt) <= 0) { scene.remove(fm.f); fumes.splice(i, 1); }
    }
  });
  interact(station, '[E] Soldering station: power on/off', () => {
    setSolder(!sol.on);
    showInfo('Soldering station', sol.on
      ? 'Heating up to <b>350 °C</b>. Wait for READY on the display, then click the circuit board in the helping hands to solder its joints.'
      : 'Off. Cooling down… (never grab the hot end, even when it says OFF).');
  });
  interact(holder, '[E] Soldering iron (power the station first)', () => {
    setSolder(!sol.on);
    showInfo('Soldering iron', sol.on ? 'Station on. Heating up to 350 °C.' : 'Station off.');
  });
  interact(hands, '[E] Solder the next joint on the board', () => {
    if (sol.joints >= JOINTS) { showInfo('Circuit board', 'All joints are done and the LED works. Shiny cone-shaped joints = good joints!'); return; }
    if (sol.temp < 300) { sfx.error(); showInfo('Too cold!', `The iron is only <b>${Math.round(sol.temp)} °C</b>. Solder melts around 190–220 °C, and you want ~350 °C for good joints. Turn on the station.`); return; }
    jointMats[sol.joints].color.set(0xe6ecf5);
    sfx.hiss();
    const p = new THREE.Vector3();
    pcb.getWorldPosition(p);
    puff(p.add(new THREE.Vector3(0, 0.02, 0)));
    sol.joints++;
    if (sol.joints === JOINTS) {
      boardLedMat.emissiveIntensity = 1.1;
      emit('solder');
      showInfo('It works!', `All ${JOINTS} joints soldered. The board's LED lights up. Flux smoke smells like victory.`);
      terminal.print('[bench] PCB test: all 8 joints OK, LED on.', '#5ad1ff');
    } else showInfo('Tssss…', `Joint ${sol.joints} of ${JOINTS} soldered.`, 2500);
  });

  // ================================================================ arcade cabinet: Packet Catcher
  const game = new PacketCatcher();
  api.game = game;
  game.onSound = (n) => sfx[n]?.();
  game.onScore = (sc) => { if (sc >= 100) emit('arcade'); };
  const arcadeTex = new THREE.CanvasTexture(game.canvas);
  arcadeTex.colorSpace = THREE.SRGBColorSpace;
  const arcadeMat = crtMaterial(arcadeTex);
  arcadeMat.userData = { ...noOutline };
  arcadeMat.uniforms.power.value = 1.35;
  const arcade = new THREE.Group();
  arcade.position.set(0.4, 0, 3.55);
  arcade.rotation.y = Math.PI;
  scene.add(arcade);
  const cabPurple = mat(C.purple), cabDark = mat(0x2d2a4a);
  for (const x of [-0.33, 0.33]) {
    box(0.05, 1.8, 0.72, cabPurple, x, 0.9, 0, arcade, 0.02);
    box(0.052, 0.08, 0.6, mat(C.yellow), x, 1.0, 0.02, arcade, 0.01);
  }
  box(0.62, 1.78, 0.5, cabDark, 0, 0.89, -0.1, arcade, 0.02);
  const screenBox = new THREE.Group();
  screenBox.position.set(0, 1.32, 0.24);
  screenBox.rotation.x = -0.18;
  arcade.add(screenBox);
  box(0.56, 0.66, 0.04, mat(0x15122a), 0, 0, 0, screenBox, 0.02);
  const arcadeScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.575), arcadeMat);
  arcadeScreen.position.z = 0.022;
  screenBox.add(arcadeScreen);
  const panel = box(0.62, 0.08, 0.3, mat(C.red), 0, 0.98, 0.3, arcade, 0.025);
  panel.rotation.x = 0.22;
  cyl(0.01, 0.01, 0.08, ink, -0.14, 1.06, 0.3, arcade, 8);
  ball(0.03, mat(C.red), -0.14, 1.1, 0.3, arcade, 14);
  ball(0.025, mat(C.yellow), 0.06, 1.035, 0.3, arcade, 12).scale.y = 0.6;
  ball(0.025, mat(C.blue), 0.15, 1.035, 0.27, arcade, 12).scale.y = 0.6;
  box(0.12, 0.16, 0.02, mat(0x8a90aa), 0, 0.55, 0.29, arcade, 0.008);
  box(0.02, 0.06, 0.01, basic(0xff5c7a), -0.02, 0.56, 0.302, arcade, 0.002);
  box(0.02, 0.06, 0.01, basic(0xff5c7a), 0.02, 0.56, 0.302, arcade, 0.002);
  const marquee = sign('PACKET CATCHER', { w: 0.6, h: 0.16, accent: '#ffcd3c', bg: '#ffcd3c', fg: '#2b2340', font: 'bold 120px "Fredoka", sans-serif' });
  marquee.position.set(0, 1.86, 0.3);
  arcade.add(marquee);
  box(0.66, 0.22, 0.12, cabPurple, 0, 1.86, 0.22, arcade, 0.02);
  const arcadeLight = new THREE.PointLight(0x8a62e8, 0.8, 2, 2);
  arcadeLight.position.set(0.4, 1.4, 3.0);
  scene.add(arcadeLight);
  collide(0.02, 0.78, 3.15, 4);
  api.arcadeFocus = {
    screen: arcadeScreen, w: 0.46, h: 0.575, fit: 1.05,
    hint: 'Playing <b>Packet Catcher</b> · ← → / A D move · Enter start · <b>Esc</b> to stand up',
    keydown: (e) => game.keydown(e),
    keyup: (e) => game.keyup(e),
    onExit: () => game.releaseAll(),
  };
  animated.push((t, dt) => {
    arcadeMat.uniforms.time.value = t;
    if (camera.position.distanceTo(arcade.position) < 7) { game.update(dt); arcadeTex.needsUpdate = true; }
  });
  interact(arcade, '[E] Play Packet Catcher (arcade)', () => k.enterFocus(api.arcadeFocus));

  // ================================================================ project corkboard
  const cork = new THREE.Group();
  cork.position.set(4.96, 1.85, -1.12);
  cork.rotation.y = -Math.PI / 2;
  scene.add(cork);
  box(1.52, 1.06, 0.04, mat(C.woodDark), 0, 0, 0, cork, 0.02);
  const corkTex = canvasTexture(1024, 700, (g, W, H) => {
    g.fillStyle = '#d6a05e'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2500; i++) { g.fillStyle = Math.random() < 0.5 ? '#c08a4a' : '#e6b673'; g.fillRect(Math.random() * W, Math.random() * H, 3, 3); }
  });
  const corkPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.96), new THREE.MeshToonMaterial({ map: corkTex, gradientMap: k.gradientMap }));
  corkPlane.material.userData = { ...noOutline };
  corkPlane.position.z = 0.021;
  cork.add(corkPlane);
  const title = sign('my projects', { w: 0.42, h: 0.1, accent: '#ef5a5a' });
  title.position.set(0, 0.41, 0.03);
  cork.add(title);
  const PROJECTS = [
    ['SecureOS', 'C · Rust · x86 ASM', 'discontinued', '#ffcd3c', 'Hobbyist and experimental x86_32 operating system written in C, Rust and x86 Assembly. The original project (now discontinued).', 'SecureOS'],
    ['SecureRustOS', 'Rust · x86', 'coming up!', '#55c26b', 'The new OS: bootloader, kernel and drivers, rewritten in Rust. Build it with the PC under the desk: <code>make run</code>.', 'SecureRustOS'],
    ['EngineManager', 'fullstack', 'work in progress', '#6fd3ff', 'A self-built password manager. The safe in the corner generates passwords for it from optical entropy.', 'EngineManager'],
    ['EngineBuddy', 'AI companion', 'vibecoding', '#ff8fb1', 'An AI desktop companion. Its little robot avatar floats around this room.', 'EngineBuddy'],
    ["Engine's Antivirus", 'Python · Rust', 'educational', '#ef5a5a', 'An educational antivirus: signature matching and heuristics. The virus jar shows what happens to what it finds.', 'Engine-s-Antivirus'],
    ['Hybrid-Entropy', 'C++ · Python', 'research', '#b79cff', 'Hybrid Entropy Computing Platform: optical entropy generation and randomness. The lava lamp is the room version.', 'Hybrid-Entropy-Computing-Platform'],
  ];
  const pinPos = [];
  PROJECTS.forEach(([name, tech, status, color, desc, repo], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = -0.46 + col * 0.46, y = 0.14 - row * 0.4;
    const card = new THREE.Group();
    card.position.set(x, y, 0.03);
    card.rotation.z = ((i * 37) % 7 - 3) * 0.02;
    cork.add(card);
    const tex = canvasTexture(512, 340, (g, W, H) => {
      g.fillStyle = '#fffdf6'; g.fillRect(0, 0, W, H);
      g.fillStyle = color; g.fillRect(0, 0, W, 70);
      g.strokeStyle = '#cfd8f0'; g.lineWidth = 3;
      for (let yy = 120; yy < H; yy += 44) { g.beginPath(); g.moveTo(20, yy); g.lineTo(W - 20, yy); g.stroke(); }
      g.fillStyle = '#2b2340'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = 46; g.font = `bold ${size}px "Fredoka", sans-serif`;
      while (g.measureText(name).width > W - 40) { size -= 2; g.font = `bold ${size}px "Fredoka", sans-serif`; }
      g.fillText(name, W / 2, 38);
      g.font = '34px "Fredoka", sans-serif'; g.fillText(tech, W / 2, 140);
      g.font = 'bold 34px "Fredoka", sans-serif'; g.fillStyle = '#ef5a5a'; g.fillText(status, W / 2, 200);
      g.font = '24px "Fredoka", sans-serif'; g.fillStyle = '#6b7290'; g.fillText(`github / ${repo}`.slice(0, 34), W / 2, 280);
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24), new THREE.MeshBasicMaterial({ map: tex }));
    plane.material.userData = { ...noOutline };
    card.add(plane);
    ball(0.016, mat([C.red, C.blue, C.green, C.yellow, C.purple, C.pink][i]), 0, 0.1, 0.012, card, 10);
    pinPos.push(new THREE.Vector3(x, y + 0.1, 0.045));
    interact(card, `Project: ${name}`, () => showInfo(name, `${desc}<br><small>github.com/EngineGames-Development/${repo}</small>`, 9000));
  });
  // red string between related projects
  const stringMat = mat(0xd0213a, { outline: false });
  [[0, 1], [1, 4], [2, 3], [5, 2], [4, 5], [0, 4]].forEach(([a, b]) => {
    const pa = pinPos[a], pb = pinPos[b];
    const len = pa.distanceTo(pb);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, len, 5), stringMat);
    s.position.copy(pa).add(pb).multiplyScalar(0.5);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pb.clone().sub(pa).normalize());
    s.userData.noHit = true;
    cork.add(s);
  });

  // ================================================================ database filing cabinet
  const cabinet = new THREE.Group();
  cabinet.position.set(4.72, 0, -1.12);
  cabinet.rotation.y = -Math.PI / 2;
  scene.add(cabinet);
  box(0.58, 1.04, 0.5, mat(0x7e8db8), 0, 0.52, 0, cabinet, 0.03);
  const DRAWERS = [
    ['projects', 'SELECT name, lang, status FROM projects'],
    ['devices', 'SELECT host, port, service FROM devices ORDER BY port'],
    ['tools', "SELECT name, category FROM tools WHERE free = 'yes'"],
  ];
  const drawers = [];
  DRAWERS.forEach(([table, query], i) => {
    const d = new THREE.Group();
    d.position.set(0, 0.86 - i * 0.31, 0.25);
    cabinet.add(d);
    box(0.52, 0.27, 0.04, mat(0x9aa8d0), 0, 0, 0, d, 0.02);
    box(0.16, 0.03, 0.03, mat(C.ink), 0, -0.06, 0.03, d, 0.012);
    const lab = sign(table, { w: 0.22, h: 0.07, accent: '#4a7fe0' });
    lab.position.set(0, 0.05, 0.022);
    d.add(lab);
    const state = { open: 0, target: 0, timer: 0 };
    drawers.push({ d, state });
    interact(d, `[E] Database: ${query}`, () => {
      state.target = 1; state.timer = 6;
      emit('sql');
      sfx.whoosh();
      const res = runSQL(query);
      const head = res.columns.map((c) => `<th>${c}</th>`).join('');
      const rows = res.rows.map((r) => `<tr>${res.columns.map((c) => `<td>${String(r[c]).replace(/</g, '&lt;')}</td>`).join('')}</tr>`).join('');
      showInfo(`mysql> ${query};`, `<table class="sql"><tr>${head}</tr>${rows}</table><small>${res.rows.length} rows · more in the terminal: <code>sql ...</code> / <code>mongo db.${table}.find({})</code></small>`, 10000);
    });
  });
  const dbSign = sign('DATABASE', { w: 0.4, h: 0.1, accent: '#4a7fe0' });
  dbSign.position.set(0, 1.045, 0.05);
  dbSign.rotation.x = -Math.PI / 2;
  cabinet.add(dbSign);
  collide(4.44, 5, -1.42, -0.82);
  animated.push((t, dt) => {
    for (const { d, state } of drawers) {
      if (state.target && (state.timer -= dt) <= 0) state.target = 0;
      state.open += (state.target - state.open) * Math.min(1, dt * 6);
      d.position.z = 0.25 + state.open * 0.22;
    }
  });

  // ================================================================ whiteboard: x86 memory map
  const wb = new THREE.Group();
  wb.position.set(3.85, 1.75, 3.96);
  wb.rotation.y = Math.PI;
  scene.add(wb);
  box(1.58, 1.06, 0.04, mat(0xd8dde8), 0, 0, 0, wb, 0.02);
  const wbTex = canvasTexture(1200, 800, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.fillStyle = '#2b4fbf'; g.font = 'bold 56px "Fredoka", "Comic Sans MS", sans-serif'; g.textAlign = 'left';
    g.fillText('x86 memory map (real mode)', 40, 80);
    const rows = [
      ['0xFFFFF', 'BIOS ROM  (reset vector!)', '#ffcd3c'],
      ['0xC0000', 'video BIOS / ROMs', '#ffe28a'],
      ['0xB8000', 'VGA text buffer', '#6fd3ff'],
      ['0xA0000', 'video memory', '#a8e4ff'],
      ['0x7E00', 'free RAM  (GDT lives here)', '#c8f0c8'],
      ['0x7C00', 'BOOTLOADER  (512 B)', '#ef5a5a'],
      ['0x0500', 'free (stack)', '#c8f0c8'],
      ['0x0400', 'BIOS data area', '#e0d0ff'],
      ['0x0000', 'IVT (interrupt vectors)', '#b79cff'],
    ];
    rows.forEach(([addr, label, col], i) => {
      const y = 120 + i * 68;
      g.fillStyle = col; g.fillRect(260, y, 520, 60);
      g.strokeStyle = '#2b2340'; g.lineWidth = 5; g.strokeRect(260, y, 520, 60);
      g.fillStyle = '#2b2340'; g.font = 'bold 30px "Fredoka", "Comic Sans MS", sans-serif'; g.fillText(label, 278, y + 41);
      g.fillStyle = '#d0213a'; g.font = 'bold 30px "DejaVu Sans Mono", monospace'; g.fillText(addr, 60, y + 41);
    });
    // doodles: arrow + A20 note + smiley
    g.strokeStyle = '#d0213a'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(1000, 520); g.quadraticCurveTo(900, 560, 800, 500); g.stroke();
    g.beginPath(); g.moveTo(800, 500); g.lineTo(830, 485); g.moveTo(800, 500); g.lineTo(820, 528); g.stroke();
    g.fillStyle = '#d0213a'; g.font = 'bold 40px "Fredoka", "Comic Sans MS", sans-serif';
    g.fillText('BIOS puts', 880, 470); g.fillText('us here!', 900, 515);
    g.strokeStyle = '#2fa86a'; g.lineWidth = 6;
    g.beginPath(); g.ellipse(1000, 200, 150, 70, -0.1, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#2fa86a'; g.font = 'bold 34px "Fredoka", "Comic Sans MS", sans-serif'; g.fillText('enable A20', 905, 195); g.fillText('for > 1 MiB!', 900, 235);
    g.strokeStyle = '#2b4fbf'; g.lineWidth = 6;
    g.beginPath(); g.arc(1040, 700, 50, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(1040, 710, 28, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = '#2b4fbf'; g.beginPath(); g.arc(1022, 685, 6, 0, 7); g.arc(1058, 685, 6, 0, 7); g.fill();
  });
  const wbPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.98), new THREE.MeshBasicMaterial({ map: wbTex }));
  wbPlane.material.userData = { ...noOutline };
  wbPlane.position.z = 0.021;
  wb.add(wbPlane);
  box(1.2, 0.03, 0.08, mat(0xd8dde8), 0, -0.55, 0.04, wb, 0.01);
  [C.red, C.blue, C.green].forEach((col, i) => {
    const mk = cyl(0.012, 0.012, 0.12, mat(col), -0.3 + i * 0.15, -0.525, 0.05, wb, 10);
    mk.rotation.z = Math.PI / 2;
  });
  interact(wb, 'Whiteboard: x86 real-mode memory map', () => showInfo('Memory map', 'Where everything lives when an x86 PC boots: the IVT at 0, the bootloader at <code>0x7C00</code>, VGA text at <code>0xB8000</code>, the BIOS at the top. The terminal has it too: <code>memmap</code>.'));

  // ================================================================ Wireshark shark plush (on the server)
  const shark = new THREE.Group();
  shark.position.set(4.5, 1.95, -2.4);
  shark.rotation.y = -Math.PI / 2;
  scene.add(shark);
  const sharkBlue = mat(0x5b8fd6), belly = mat(0xf4f7ff);
  const sBody = ball(0.12, sharkBlue, 0, 0.09, 0, shark, 22);
  sBody.scale.set(0.85, 0.75, 1.7);
  const sBelly = ball(0.1, belly, 0, 0.065, 0.02, shark, 18);
  sBelly.scale.set(0.8, 0.55, 1.55);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 4), sharkBlue);
  fin.position.set(0, 0.2, -0.02);
  fin.scale.z = 0.4;
  shark.add(fin);
  for (const side of [-1, 1]) {
    const pf = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 4), sharkBlue);
    pf.position.set(side * 0.1, 0.04, 0.04);
    pf.rotation.z = side * 1.9;
    shark.add(pf);
    ball(0.013, ink, side * 0.05, 0.12, 0.16, shark, 10);
  }
  const tailG = new THREE.Group();
  tailG.position.set(0, 0.1, -0.2);
  shark.add(tailG);
  [0.6, -0.6].forEach((r) => {
    const tf = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 4), sharkBlue);
    tf.rotation.x = -Math.PI / 2 + r;
    tf.position.set(0, r * 0.05, -0.04);
    tf.scale.x = 0.4;
    tailG.add(tf);
  });
  const sSmile = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12, Math.PI), ink);
  sSmile.position.set(0, 0.07, 0.175);
  sSmile.rotation.z = Math.PI;
  shark.add(sSmile);
  animated.push((t) => { tailG.rotation.y = Math.sin(t * 3) * 0.3; });
  interact(shark, '[E] Wireshark the plush shark: toggle packet capture', () => {
    k.toggleCapture();
    showInfo('Wireshark plush', 'This shark sniffs packets for fun. Toggled the live capture panel.');
  });

  // ================================================================ Nmap telescope at the window
  const scopeStand = new THREE.Group();
  scopeStand.position.set(-2.6, 0, 3.25);
  scene.add(scopeStand);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cyl(0.012, 0.012, 1.12, mat(C.ink), Math.cos(a) * 0.17, 0.53, Math.sin(a) * 0.17, scopeStand, 8);
    leg.rotation.set(-Math.sin(a) * 0.16, 0, Math.cos(a) * 0.16); // tops lean in to meet the head
  }
  ball(0.04, mat(C.grey), 0, 1.08, 0, scopeStand, 12);
  const tube = new THREE.Group();
  tube.position.set(0, 1.12, 0);
  scopeStand.add(tube);
  tube.lookAt(new THREE.Vector3(-1.6, 2.0, 4.5)); // tube local +z points out of the window
  const t1 = cyl(0.055, 0.045, 0.62, mat(0xffffff), 0, 0, 0.12, tube, 20);
  t1.rotation.x = Math.PI / 2;
  const t2 = cyl(0.062, 0.062, 0.09, mat(C.red), 0, 0, 0.42, tube, 20);
  t2.rotation.x = Math.PI / 2;
  const t3 = cyl(0.02, 0.025, 0.1, mat(C.yellow), 0, 0, -0.22, tube, 12);
  t3.rotation.x = Math.PI / 2;
  collide(-2.82, -2.38, 3.03, 3.5);
  const scopeHitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  scopeHitMat.userData = { ...noOutline };
  const scopeHit = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.35, 0.45), scopeHitMat); // easier to aim at than thin legs
  scopeHit.position.y = 0.68;
  scopeStand.add(scopeHit);
  interact(scopeStand, '[E] Nmap telescope: scan the neighborhood', () => {
    const lines = HOSTS.map((h) => `<code>${h.ip.join('.')}</code> ${h.name}: ${h.ports.join(', ')}`).join('<br>');
    showInfo('nmap -sV 10.0.0.0/24', `Spotted ${HOSTS.length} hosts up:<br>${lines}<br><small>Full output in the terminal: <code>nmap</code></small>`, 10000);
  });

  // ================================================================ Tux plush with Linux jokes
  const tux = new THREE.Group();
  tux.position.set(2.62, 0, 1.95);
  tux.rotation.y = -2.4;
  scene.add(tux);
  const black = mat(0x26233a), whiteFur = mat(0xffffff), beak = mat(0xffb020);
  const tBody = ball(0.17, black, 0, 0.2, 0, tux, 24);
  tBody.scale.set(1, 1.15, 0.9);
  const tBelly = ball(0.14, whiteFur, 0, 0.18, 0.05, tux, 22);
  tBelly.scale.set(0.9, 1.1, 0.75);
  const tHead = new THREE.Group();
  tHead.position.set(0, 0.42, 0);
  tux.add(tHead);
  ball(0.12, black, 0, 0, 0, tHead, 22);
  const face = ball(0.095, whiteFur, 0, -0.01, 0.045, tHead, 20);
  face.scale.set(1, 0.95, 0.75);
  for (const side of [-1, 1]) {
    ball(0.028, whiteFur, side * 0.035, 0.03, 0.105, tHead, 12);
    ball(0.013, ink, side * 0.035, 0.03, 0.128, tHead, 10);
    const wing = ball(0.07, black, side * 0.16, 0.22, 0, tux, 14);
    wing.scale.set(0.35, 1.1, 0.7);
    wing.rotation.z = side * 0.25;
    const foot = ball(0.06, beak, side * 0.07, 0.025, 0.08, tux, 12);
    foot.scale.set(1, 0.4, 1.4);
  }
  const tBeak = ball(0.04, beak, 0, -0.02, 0.12, tHead, 12);
  tBeak.scale.set(1.2, 0.55, 1);
  // speech bubble
  const bubbleCanvas = document.createElement('canvas');
  bubbleCanvas.width = 768; bubbleCanvas.height = 384;
  const bubbleTex = new THREE.CanvasTexture(bubbleCanvas);
  bubbleTex.colorSpace = THREE.SRGBColorSpace;
  const bubble = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshBasicMaterial({ map: bubbleTex, alphaTest: 0.5 }));
  bubble.material.userData = { ...noOutline };
  bubble.userData.noHit = true;
  bubble.visible = false;
  scene.add(bubble);
  const JOKES = [
    'Linux is user friendly. It is just picky about who its friends are.',
    'Why do Linux users never get lost? They always know their pwd.',
    'How do you exit Vim? Nobody knows. I have been in here since 2009.',
    'sudo make me a sandwich. Okay. (Penguins respect sudo.)',
    'rm -rf / : the fastest way to free up disk space, and your weekend.',
    'My favourite dance move? chmod 777. Everyone is allowed in!',
    'There is no place like 127.0.0.1. Except my igloo.',
    'Why did the penguin leave Windows? Too many blue screens of commitment.',
    'I asked for a kernel panic and got a kernel picnic. Close enough.',
    'Real penguins do not reboot. We just systemctl restart our mood.',
    'A Linux user walks into a bar. Then compiles the bar from source.',
    'Why is Tux always calm? Because everything is a file, even feelings.',
  ];
  let jokeIdx = Math.floor(Math.random() * JOKES.length);
  let bubbleTimer = 0, hop = 0;
  function drawBubble(text) {
    const g = bubbleCanvas.getContext('2d');
    const W = bubbleCanvas.width, H = bubbleCanvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#2b2340';
    roundRectPath(g, 8, 8, W - 16, H - 80, 50); g.fill();
    g.beginPath(); g.moveTo(W * 0.42, H - 76); g.lineTo(W * 0.5, H - 8); g.lineTo(W * 0.56, H - 76); g.fill();
    g.fillStyle = '#fff3dc';
    roundRectPath(g, 18, 18, W - 36, H - 100, 42); g.fill();
    g.beginPath(); g.moveTo(W * 0.44, H - 84); g.lineTo(W * 0.5, H - 26); g.lineTo(W * 0.54, H - 84); g.fill();
    g.fillStyle = '#2b2340'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 44;
    let lines;
    do {
      g.font = `bold ${size}px "Fredoka", sans-serif`;
      lines = wrap(g, text, W - 90);
      size -= 2;
    } while (lines.length * size * 1.25 > H - 140 && size > 20);
    const lh = (size + 2) * 1.2;
    lines.forEach((l, i) => g.fillText(l, W / 2, (H - 80) / 2 + 10 + (i - (lines.length - 1) / 2) * lh));
    bubbleTex.needsUpdate = true;
  }
  animated.push((t, dt) => {
    tHead.rotation.z = Math.sin(t * 1.3) * 0.08;
    if (hop > 0) { hop -= dt; tux.position.y = Math.abs(Math.sin(hop * 12)) * 0.08 * (hop / 0.8); } else tux.position.y = 0;
    if (bubbleTimer > 0) {
      bubbleTimer -= dt;
      bubble.visible = true;
      bubble.position.set(tux.position.x, 1.05, tux.position.z);
      bubble.lookAt(camera.position);
      bubble.scale.setScalar(Math.min(1, (6.5 - Math.max(bubbleTimer, 0)) * 5) * (bubbleTimer < 0.3 ? bubbleTimer / 0.3 : 1));
    } else bubble.visible = false;
  });
  collide(2.4, 2.84, 1.73, 2.17);
  interact(tux, '[E] Tux plush: tell me a Linux joke', () => {
    jokeIdx = (jokeIdx + 1) % JOKES.length;
    drawBubble(JOKES[jokeIdx]);
    bubbleTimer = 6.5;
    hop = 0.8;
    sfx.squeak();
    emit('tux');
    terminal.print(`tux: ${JOKES[jokeIdx]}`, '#c792ea');
  });

  // ================================================================ quadcopter drone
  const pad = new THREE.Group();
  pad.position.set(-2.9, 0, -2.0);
  scene.add(pad);
  const padTex = canvasTexture(256, 256, (g, W, H) => {
    g.fillStyle = '#2b2340'; g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffcd3c'; g.lineWidth = 14; g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 22, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffcd3c'; g.font = 'bold 150px "Fredoka", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('H', W / 2, H / 2 + 8);
  });
  const padMesh = new THREE.Mesh(new THREE.CircleGeometry(0.4, 40), new THREE.MeshToonMaterial({ map: padTex, gradientMap: k.gradientMap, alphaTest: 0.5 }));
  padMesh.material.userData = { ...noOutline };
  padMesh.rotation.x = -Math.PI / 2;
  padMesh.position.y = 0.008;
  padMesh.receiveShadow = true;
  pad.add(padMesh);

  const drone = new THREE.Group();
  scene.add(drone);
  const droneBody = new THREE.Group();
  drone.add(droneBody);
  box(0.16, 0.05, 0.16, mat(C.red), 0, 0, 0, droneBody, 0.02);
  box(0.09, 0.03, 0.09, mat(0x2b2340), 0, 0.035, 0, droneBody, 0.012);
  const cam = ball(0.022, mat(C.ink), 0, -0.02, 0.085, droneBody, 10);
  cam.scale.z = 0.7;
  const props = [];
  const droneLeds = [];
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sz], i) => {
    const armM = box(0.2, 0.018, 0.022, mat(C.grey), sx * 0.09, 0, sz * 0.09, droneBody, 0.008);
    armM.rotation.y = sx * sz > 0 ? -Math.PI / 4 : Math.PI / 4;
    const hub = cyl(0.022, 0.022, 0.04, mat(C.ink), sx * 0.15, 0.015, sz * 0.15, droneBody, 12);
    const rotor = new THREE.Group();
    rotor.position.set(sx * 0.15, 0.04, sz * 0.15);
    droneBody.add(rotor);
    box(0.17, 0.004, 0.02, mat(0xffffff), 0, 0, 0, rotor, 0.002);
    props.push(rotor);
    const led = ball(0.01, new THREE.MeshBasicMaterial({ color: sz > 0 ? 0x44ff66 : 0xff4466 }), sx * 0.15, -0.012, sz * 0.15, droneBody, 8);
    led.material.userData = { ...noOutline };
    droneLeds.push(led);
    hub.castShadow = true;
  });
  for (const sx of [-1, 1]) box(0.012, 0.04, 0.14, mat(C.ink), sx * 0.06, -0.045, 0, droneBody, 0.005); // skids
  const home = new THREE.Vector3(-2.9, 0.07, -2.0);
  drone.position.copy(home);
  const fly = { state: 'idle', t: 0, vel: new THREE.Vector3(), stopBuzz: null };
  const tmpTarget = new THREE.Vector3(), prevPos = new THREE.Vector3();
  api.launchDrone = () => {
    if (fly.state !== 'idle') return false;
    fly.state = 'takeoff'; fly.t = 0;
    fly.stopBuzz = sfx.buzz();
    emit('drone');
    return true;
  };
  animated.push((t, dt) => {
    const spin = fly.state === 'idle' ? 0 : 60;
    props.forEach((p, i) => { p.rotation.y += dt * spin * (i % 2 ? 1 : -1); });
    droneLeds.forEach((l, i) => { l.visible = fly.state === 'idle' || Math.floor(t * 4 + i) % 2 === 0; });
    if (fly.state === 'idle') return;
    fly.t += dt;
    const ORBIT = 14, R = 2.1, cx = 0, cz = 0.3, alt = 2.25;
    if (fly.state === 'takeoff') {
      tmpTarget.set(home.x, 1.8, home.z);
      if (fly.t > 2.2) { fly.state = 'orbit'; fly.t = 0; }
    } else if (fly.state === 'orbit') {
      const a = Math.atan2(home.z - cz, home.x - cx) + (fly.t / ORBIT) * Math.PI * 2;
      tmpTarget.set(cx + Math.cos(a) * R, alt + Math.sin(fly.t * 2.2) * 0.12, cz + Math.sin(a) * R * 0.95);
      if (fly.t > ORBIT) { fly.state = 'return'; fly.t = 0; }
    } else if (fly.state === 'return') {
      tmpTarget.set(home.x, 1.5, home.z);
      if (fly.t > 2.5) { fly.state = 'land'; fly.t = 0; }
    } else if (fly.state === 'land') {
      tmpTarget.copy(home);
      if (fly.t > 2.2) { fly.state = 'idle'; drone.position.copy(home); droneBody.rotation.set(0, 0, 0); fly.stopBuzz?.(); return; }
    }
    prevPos.copy(drone.position);
    drone.position.lerp(tmpTarget, Math.min(1, dt * (fly.state === 'orbit' ? 2.5 : 1.6)));
    fly.vel.copy(drone.position).sub(prevPos).divideScalar(Math.max(dt, 1e-3));
    // bank into the direction of travel
    droneBody.rotation.x += (THREE.MathUtils.clamp(fly.vel.z * 0.25, -0.4, 0.4) - droneBody.rotation.x) * Math.min(1, dt * 5);
    droneBody.rotation.z += (THREE.MathUtils.clamp(-fly.vel.x * 0.25, -0.4, 0.4) - droneBody.rotation.z) * Math.min(1, dt * 5);
    drone.rotation.y += dt * 0.6;
  });
  interact(drone, '[E] Quadcopter: launch!', () => {
    if (api.launchDrone()) showInfo('Quadcopter', 'Takeoff! Four brushless motors, a flight controller doing PID loops at 1 kHz, and a tiny camera. It flies a lap around the room and lands back on its pad.');
    else showInfo('Quadcopter', 'Already in the air. Look up!');
  });
  interact(pad, '[E] Quadcopter: launch!', () => { if (api.launchDrone()) showInfo('Quadcopter', 'Takeoff!'); });
  collide(-3.15, -2.65, -2.25, -1.75);

  return api;
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

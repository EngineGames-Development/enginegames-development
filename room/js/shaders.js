// Custom GLSL shaders: CRT monitor, lava lamp metaballs, GPU demo screen, night sky.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// --------------------------------------------------------------- CRT
export function crtMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: texture }, time: { value: 0 }, power: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float time;
      uniform float power;
      varying vec2 vUv;
      vec2 barrel(vec2 uv) {
        vec2 c = uv * 2.0 - 1.0;
        c *= 1.0 + 0.045 * dot(c, c);
        return c * 0.5 + 0.5;
      }
      void main() {
        vec2 uv = barrel(vUv);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        // slight chromatic offset
        float r = texture2D(map, uv + vec2(0.0012, 0.0)).r;
        float g = texture2D(map, uv).g;
        float b = texture2D(map, uv - vec2(0.0012, 0.0)).b;
        vec3 col = vec3(r, g, b);
        float scan = 0.82 + 0.18 * sin(uv.y * 768.0 * 3.14159);
        float roll = 0.96 + 0.04 * sin(uv.y * 8.0 - time * 3.0);
        vec2 v = uv * (1.0 - uv);
        float vig = pow(v.x * v.y * 15.0, 0.25);
        float flicker = 0.97 + 0.03 * sin(time * 60.0);
        col *= scan * roll * vig * flicker * power;
        col += vec3(0.0, 0.025, 0.012) * power; // phosphor glow
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// --------------------------------------------------------------- lava lamp
export function lavaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, hue: { value: 0.85 } },
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform float hue;
      varying vec2 vUv;
      varying vec3 vNormal;
      vec3 hsv(float h, float s, float v) {
        vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return v * mix(vec3(1.0), k, s);
      }
      void main() {
        vec2 p = vec2(vUv.x * 3.0, vUv.y * 2.2);
        float f = 0.0;
        for (int i = 0; i < 7; i++) {
          float fi = float(i);
          float speed = 0.12 + fi * 0.031;
          float y = 0.5 + 0.48 * sin(time * speed + fi * 1.7) * 2.0 + 0.6;
          float x = 1.5 + 1.2 * sin(time * 0.21 + fi * 2.3);
          vec2 c = vec2(mod(x + vUv.x * 0.0, 3.0), y);
          float r = 0.18 + 0.07 * sin(fi * 3.1 + time * 0.4);
          vec2 d = p - c;
          d.x = mod(d.x + 1.5, 3.0) - 1.5;
          f += r * r / max(dot(d, d), 1e-4);
        }
        float blob = smoothstep(0.9, 1.15, f);
        vec3 liquid = hsv(hue + 0.08, 0.7, 0.35);
        vec3 wax = hsv(hue, 0.85, 1.0);
        vec3 col = mix(liquid, wax * 1.6, blob);
        float rim = pow(1.0 - abs(vNormal.z), 2.0);
        col += rim * 0.25 * wax;
        gl_FragColor = vec4(col, 0.92);
      }`,
  });
}

// --------------------------------------------------------------- GPU demo screen
export const GPU_MODES = ['raymarch', 'plasma', 'mandelbrot'];

export function gpuMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, mode: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform int mode;
      varying vec2 vUv;

      float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
      mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
      float map(vec3 p) {
        vec3 q = p;
        q.xy *= rot(time * 0.7);
        q.yz *= rot(time * 0.5);
        float t = sdTorus(q, vec2(0.9, 0.3));
        float s = length(p - vec3(0.0, 0.0, 0.0)) - 0.45 - 0.05 * sin(time * 3.0);
        float k = 0.3;
        float h = clamp(0.5 + 0.5 * (s - t) / k, 0.0, 1.0);
        return mix(s, t, h) - k * h * (1.0 - h);
      }
      vec3 raymarch(vec2 uv) {
        vec3 ro = vec3(0.0, 0.0, 3.2), rd = normalize(vec3(uv, -1.6));
        float d = 0.0;
        for (int i = 0; i < 64; i++) {
          vec3 p = ro + rd * d;
          float h = map(p);
          if (h < 0.001 || d > 8.0) break;
          d += h;
        }
        if (d > 8.0) return vec3(0.02, 0.02, 0.06) + 0.05 * vec3(uv.y + 0.5);
        vec3 p = ro + rd * d;
        vec2 e = vec2(0.001, 0.0);
        vec3 n = normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
        vec3 l = normalize(vec3(0.6, 0.8, 0.5));
        float diff = max(dot(n, l), 0.0);
        float spec = pow(max(dot(reflect(-l, n), -rd), 0.0), 32.0);
        vec3 base = 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + p.y * 2.0 + time);
        return base * (0.15 + diff) + spec;
      }
      vec3 plasma(vec2 uv) {
        float v = sin(uv.x * 6.0 + time) + sin(uv.y * 7.0 - time * 1.3) + sin((uv.x + uv.y) * 5.0 + time * 0.7)
                + sin(length(uv * 8.0) - time * 2.0);
        return 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + v * 1.5);
      }
      vec3 mandel(vec2 uv) {
        float zoom = pow(1.6, mod(time * 0.6, 18.0));
        vec2 c = vec2(-0.743643887, 0.131825904) + uv * 2.5 / zoom;
        vec2 z = vec2(0.0);
        float it = 0.0;
        for (int i = 0; i < 200; i++) {
          z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
          if (dot(z, z) > 4.0) break;
          it += 1.0;
        }
        if (it >= 199.0) return vec3(0.0);
        float t = it / 200.0;
        return 0.5 + 0.5 * cos(6.2831 * (t * 3.0 + vec3(0.0, 0.33, 0.67)));
      }
      void main() {
        vec2 uv = (vUv - 0.5) * vec2(1.6, 1.0);
        vec3 col = mode == 0 ? raymarch(uv) : mode == 1 ? plasma(uv) : mandel(uv);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// --------------------------------------------------------------- window night sky
export function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 col = mix(vec3(0.02, 0.03, 0.09), vec3(0.09, 0.05, 0.2), vUv.y);
        vec2 g = floor(vUv * vec2(120.0, 80.0));
        float s = hash(g);
        if (s > 0.985) col += vec3(0.8, 0.85, 1.0) * (0.6 + 0.4 * sin(time * (2.0 + s * 5.0) + s * 40.0));
        // distant city skyline
        float x = vUv.x * 24.0;
        float h = 0.12 + 0.18 * hash(vec2(floor(x), 3.0));
        if (vUv.y < h) {
          col = vec3(0.015, 0.015, 0.035);
          vec2 w = floor(vec2(vUv.x * 220.0, vUv.y * 120.0));
          if (hash(w) > 0.78 && mod(w.x, 2.0) < 1.0) col = vec3(0.9, 0.7, 0.35) * 0.6;
        }
        // moon
        float m = length((vUv - vec2(0.78, 0.75)) * vec2(1.4, 1.0));
        col += vec3(0.9, 0.9, 1.0) * smoothstep(0.07, 0.06, m) + vec3(0.2, 0.2, 0.4) * smoothstep(0.25, 0.0, m) * 0.4;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

import * as THREE from 'three';
import { tiles } from './surface.js';
import { generator } from './random.js';
import { KINDS, BOARD, BOARD_SPAN, PAINT } from './fence.js';

// Дощатые части избы — из тех же досок, что забор: фронтоны чердака (доски «ёлочкой»), тесовая крыша
// с коньком и причелинами, отлив над цоколем. Доска — призма толщиной T по многоугольнику в своей плоскости:
// так фронтонную доску можно срезать по скату. Лицо и кромки одеты картинкой доски забора (вдоль волокон),
// поперечные срезы — торцами досок забора (board-end.jpg, 5 штук по 10 × 2,5 см друг под другом).
// Доски забора крашены голубым; краску перекрашиваем в цвет старого дерева так же, как забор: по яркости
// картинки (сучки и потёртости остаются), а цвет у каждой части свой.
const T = 0.022;                         // м — толщина доски
const ENDS = 5;                          // торцов в board-end.jpg
const TONES = {                          // линейные цвета старого некрашеного дерева
  gable: new THREE.Color(0.13, 0.105, 0.085), // фронтон — тёмный, бурый, как на образце
  roof: new THREE.Color(0.2, 0.19, 0.18),     // тёс крыши — серый, выбеленный солнцем и дождём
  drip: new THREE.Color(0.22, 0.2, 0.18),     // отлив — серый, светлее стен
};
const GABLE_ANGLE = Math.PI / 4;         // доски фронтона идут под 45° и сходятся «ёлочкой» на середине
const EAVE = 0.45, GABLE_OVER = 0.2;     // м — свес крыши за боковые стены и за фронтоны
const ROOF_BOARD = 0.14, BARGE = 0.2;    // м — ширина доски тёса и причелины
const DRIP = { length: 0.18, slope: 0.6, width: BOARD }; // отлив: вынос от стены, уклон (рад), ширина доски

const boardMaps = tiles(Array.from({ length: KINDS }, (_, i) => `assets/textures/fence-board-${i + 1}.jpg`));
const [endMap] = tiles(['assets/textures/board-end.jpg']);

// Краска доски забора → старое дерево цвета color: яркость картинки, делённая на яркость средней краски.
// paint — доска крашена: { color, wear }; wear = { centre, across, half } — истёртая ногами полоса: на верхних
// гранях в пределах half от прямой через centre (поперёк неё — across) краска стёрта до дерева, к краям
// остаётся, граница рваная. Без wear доска крашена вся.
function weathered(map, color, paint) {
  const material = new THREE.MeshLambertMaterial({ map, color });
  const wear = paint?.wear;
  material.onBeforeCompile = (shader) => {
    if (paint) {
      Object.assign(shader.uniforms, {
        uPaint: { value: new THREE.Color(...paint.color) },
        uCentre: { value: new THREE.Vector3(...(wear?.centre ?? [0, 0, 0])) },
        uAcross: { value: new THREE.Vector3(...(wear?.across ?? [1, 0, 0])) },
        uHalf: { value: wear?.half ?? 0 },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nvarying float vUp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${paint ? `
        uniform vec3 uPaint, uCentre, uAcross; uniform float uHalf; varying vec3 vWorld; varying float vUp;
        float wearHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wearNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wearHash(i), wearHash(i + vec2(1, 0)), f.x), mix(wearHash(i + vec2(0, 1)), wearHash(i + vec2(1, 1)), f.x), f.y);
        }` : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
        const vec3 LUMA = vec3(0.299, 0.587, 0.114);
        float grainTone = dot(sampledDiffuseColor.rgb, LUMA) / dot(${PAINT}, LUMA);
        diffuseColor.rgb = diffuse * grainTone;${paint ? `
        float side = abs(dot(vWorld - uCentre, uAcross)) / max(uHalf, 1e-4);
        float ragged = 0.6 * wearNoise(vWorld.xz * 9.0) + 0.4 * wearNoise(vWorld.xz * 31.0 + 5.0);
        float worn = (1.0 - smoothstep(0.35, 0.8, side + (ragged - 0.5) * 0.5)) * step(0.7, vUp) * step(1e-4, uHalf);
        diffuseColor.rgb = mix(uPaint * grainTone, diffuseColor.rgb, worn);` : ''}
      #endif`);
  };
  material.customProgramCacheKey = () => (paint ? `painted ${wear ? 'worn' : ''}` : 'weathered');
  return material;
}
// Материалы досок цвета color (дерево без краски) — по картинке доски забора на лицо и торцы забора на срезы.
export const boardMaterials = (color, paint) => ({ faces: boardMaps.map((map) => weathered(map, color, paint)), ends: weathered(endMap, color, paint) });
const materials = Object.fromEntries(Object.entries(TONES).map(([part, color]) => [part, boardMaterials(color)]));

// Многоугольник poly (точки [x, y]) по одну сторону прямой: где x·nx + y·ny ≤ c (Сазерленд — Ходжман).
function clip(poly, [nx, ny, c]) {
  const out = [];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length], dp = p[0] * nx + p[1] * ny - c, dq = q[0] * nx + q[1] * ny - c;
    if (dp <= 0) out.push(p);
    if (dp * dq < 0) out.push(p.map((v, k) => v + ((q[k] - v) * dp) / (dp - dq)));
  });
  return out;
}
const area = (poly) => Math.abs(poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

// Набор досок одной части дома: для каждой картинки доски — свои грани лица и торцов.
// materials — из boardMaterials, thick — толщина доски (брус — та же доска, только толще).
export class Planks {
  constructor(materials, thick = T) {
    this.materials = materials;
    this.thick = thick;
    this.kinds = Array.from({ length: KINDS }, () => ({ face: mesh(), end: mesh() }));
  }

  // Доска по многоугольнику poly в плоскости frame = { o, X, Y } (точка a, b — это o + a·X + b·Y), лицом к n.
  // along — направление волокон в этой плоскости, width — ширина доски поперёк него, rnd — случайность раскладки.
  add(poly, { o, X, Y }, n, along, width, rnd) {
    const kind = this.kinds[Math.floor(rnd() * KINDS)], shift = rnd(), row = Math.floor(rnd() * ENDS);
    const s = ([a, b]) => a * along[0] + b * along[1];             // вдоль волокон
    const t = ([a, b]) => b * along[0] - a * along[1];             // поперёк
    const t0 = Math.min(...poly.map(t));
    const at = ([a, b], h) => o.clone().addScaledVector(X, a).addScaledVector(Y, b).addScaledVector(n, h);
    const grain = (p) => [(t(p) - t0) / width, s(p) / BOARD_SPAN + shift];
    // Лицо и тыл — веером от первой вершины.
    const T = this.thick;
    for (const [h, side] of [[T, 1], [0, -1]]) {
      for (let i = 1; i + 1 < poly.length; i++) {
        triangle(kind.face, [poly[0], poly[i], poly[i + 1]].map((p) => [at(p, h), grain(p)]), n.clone().multiplyScalar(side));
      }
    }
    // Кромки. Кромка вдоль волокон — та же картинка доски, срез поперёк — торец доски забора.
    const middle = poly.reduce((m, p) => [m[0] + p[0] / poly.length, m[1] + p[1] / poly.length], [0, 0]);
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length], e = [q[0] - p[0], q[1] - p[1]], len = Math.hypot(...e);
      if (len < 1e-4) return;
      let out = X.clone().multiplyScalar(e[1]).addScaledVector(Y, -e[0]).normalize();
      if ((p[0] - middle[0]) * e[1] - (p[1] - middle[1]) * e[0] < 0) out.negate();
      const lengthwise = Math.abs((e[0] * along[0] + e[1] * along[1]) / len) > 0.7;
      const uv = lengthwise
        ? (r, h) => [h / BOARD, s(r) / BOARD_SPAN + shift]
        : (r, h) => [(t(r) - t0) / width, (row + h / T) / ENDS];
      const target = lengthwise ? kind.face : kind.end;
      const corners = [[p, 0], [q, 0], [q, T], [p, T]].map(([r, h]) => [at(r, h), uv(r, h)]);
      triangle(target, [corners[0], corners[1], corners[2]], out);
      triangle(target, [corners[0], corners[2], corners[3]], out);
    });
  }

  // Меши части: по одному на картинку доски, торцы — второй группой граней.
  meshes() {
    const { faces, ends } = this.materials;
    return this.kinds.filter((k) => k.face.pos.length).map((k, i) => {
      const geometry = new THREE.BufferGeometry();
      for (const [name, size] of [['pos', 3], ['normal', 3], ['uv', 2]]) {
        geometry.setAttribute(name === 'pos' ? 'position' : name, new THREE.Float32BufferAttribute([...k.face[name], ...k.end[name]], size));
      }
      geometry.addGroup(0, k.face.pos.length / 3, 0);
      geometry.addGroup(k.face.pos.length / 3, k.end.pos.length / 3, 1);
      const m = new THREE.Mesh(geometry, [faces[this.kinds.indexOf(k)], ends]);
      m.castShadow = m.receiveShadow = true;
      return m;
    });
  }
}
const mesh = () => ({ pos: [], normal: [], uv: [] });
// Треугольник из вершин [точка, uv], обход — так, чтобы лицо смотрело к want.
function triangle(target, vertices, want) {
  const [a, b, c] = vertices;
  const normal = b[0].clone().sub(a[0]).cross(c[0].clone().sub(a[0]));
  for (const [p, uv] of normal.dot(want) >= 0 ? [a, b, c] : [a, c, b]) {
    target.pos.push(p.x, p.y, p.z);
    target.normal.push(want.x, want.y, want.z);
    target.uv.push(...uv);
  }
}

// Чердак, крыша и отлив дома plan. Высоты от сруба: front — верх фасадных стен, side — верх боковых
// (на них лежит крыша), plinth — верх цоколя, r — радиус бревна (насколько стена выступает от оси),
// reach — докуда от середины дома торчат остатки брёвен фасада за углом.
export function buildBoards({ seed, w, d, pitch, openings }, { front, side, plinth, r, reach }) {
  const rnd = generator(seed + 2);
  const tan = Math.tan(pitch), hx = w / 2 + r;
  // Скат проходит над верхним бревном боковой стены и над остатками верхних брёвен фасада за углом —
  // они уходят под свес, а не сквозь него. Запас — на неровность брёвен (сбег, толщина, обвод).
  const clear = 0.25 * r;
  const ridge = Math.max(side + clear + (w / 2) * tan, front + clear + (reach + 0.05) * tan);
  const gable = new Planks(materials.gable), roof = new Planks(materials.roof), drip = new Planks(materials.drip);

  // Фронтоны спереди и сзади: треугольник от верха фасадной стены до ската, доски ёлочкой.
  const base = [[-hx, front - 0.06], [hx, front - 0.06], [hx, ridge], [-hx, ridge]];
  const under = [[tan, 1, ridge - 0.004], [-tan, 1, ridge - 0.004]]; // y ± x·tan ≤ конёк: под скатами
  for (const face of [1, -1]) {
    const frame = { o: new THREE.Vector3(0, 0, face * (d / 2 + 0.55 * r)), X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0) };
    const n = new THREE.Vector3(0, 0, face);
    for (const half of [-1, 1]) {
      const shape = [...under, [-half, 0, 0]].reduce(clip, base);
      const along = [half * Math.cos(GABLE_ANGLE), Math.sin(GABLE_ANGLE)], across = [-along[1], along[0]];
      const spans = shape.map(([x, y]) => x * across[0] + y * across[1]);
      for (let c = Math.min(...spans); c < Math.max(...spans); c += BOARD + 0.004) {
        const strip = [[-across[0], -across[1], -c], [across[0], across[1], c + BOARD]].reduce(clip, shape);
        if (strip.length > 2 && area(strip) > 1e-4) gable.add(strip, frame, n, along, BOARD, rnd);
      }
    }
    // Причелины — широкие доски по краю скатов, под свесом крыши.
    const barge = { o: new THREE.Vector3(0, 0, face * (d / 2 + r + GABLE_OVER - 0.03)), X: frame.X, Y: frame.Y };
    const reach = hx + EAVE, drop = BARGE / Math.cos(pitch);
    for (const s of [-1, 1]) {
      const edge = [[0, ridge], [s * reach, ridge - reach * tan], [s * reach, ridge - reach * tan - drop], [0, ridge - drop]];
      roof.add(edge, barge, n, [s * Math.cos(pitch), -Math.sin(pitch)], BARGE, rnd);
    }
  }

  // Скаты — тёс вдоль ската от конька до свеса; каждая вторая доска лежит чуть выше, внахлёст.
  const length = (hx + EAVE) / Math.cos(pitch), zEnd = d / 2 + r + GABLE_OVER;
  for (const s of [-1, 1]) {
    const X = new THREE.Vector3(s * Math.cos(pitch), -Math.sin(pitch), 0), Y = new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3(s * Math.sin(pitch), Math.cos(pitch), 0);
    let k = 0;
    for (let z = -zEnd; z < zEnd - 0.02; z += ROOF_BOARD, k++) {
      const o = new THREE.Vector3(0, ridge, 0).addScaledVector(n, (k % 2) * 0.012);
      const tail = length + (rnd() - 0.5) * 0.04;
      roof.add([[0, z], [tail, z], [tail, Math.min(z + ROOF_BOARD + 0.01, zEnd)], [0, Math.min(z + ROOF_BOARD + 0.01, zEnd)]], { o, X, Y }, n, [1, 0], ROOF_BOARD, rnd);
    }
    // Конёк — доска вдоль конька на каждом скате, поверх тёса.
    const o = new THREE.Vector3(0, ridge, 0).addScaledVector(n, 0.012 + T);
    roof.add([[-0.02, -zEnd], [0.17, -zEnd], [0.17, zEnd], [-0.02, zEnd]], { o, X, Y }, n, [0, 1], 0.19, rnd);
  }

  // Отлив: короткие доски поперёк стены над цоколем, с уклоном наружу, торцами к улице. Под дверью его нет.
  const walls = [
    { name: 'front', out: [0, 0, 1], along: [1, 0, 0], half: w / 2, at: d / 2 },
    { name: 'back', out: [0, 0, -1], along: [1, 0, 0], half: w / 2, at: d / 2 },
    { name: 'left', out: [-1, 0, 0], along: [0, 0, 1], half: d / 2, at: w / 2 },
    { name: 'right', out: [1, 0, 0], along: [0, 0, 1], half: d / 2, at: w / 2 },
  ];
  for (const { name, out, along, half, at } of walls) {
    const e = new THREE.Vector3(...out), t = new THREE.Vector3(...along);
    const X = e.clone().multiplyScalar(Math.cos(DRIP.slope)).setY(-Math.sin(DRIP.slope));
    const n = e.clone().multiplyScalar(Math.sin(DRIP.slope)).setY(Math.cos(DRIP.slope));
    const doors = openings.filter((o) => o.wall === name && o.kind === 'door');
    for (let s = -half - r; s < half + r - 0.02; s += DRIP.width + 0.008) {
      if (doors.some((o) => Math.abs(s + DRIP.width / 2 - o.at) < (o.porch ?? o.width) / 2 + 0.1)) continue; // у двери — крыльцо
      const o = e.clone().multiplyScalar(at + 0.4 * r).addScaledVector(t, s).setY(plinth + 0.05);
      const tail = DRIP.length + r * 0.6 + (rnd() - 0.5) * 0.03;
      drip.add([[0, 0], [tail, 0], [tail, DRIP.width], [0, DRIP.width]], { o, X, Y: t }, n, [1, 0], DRIP.width, rnd);
    }
  }
  return new THREE.Group().add(...gable.meshes(), ...roof.meshes(), ...drip.meshes());
}

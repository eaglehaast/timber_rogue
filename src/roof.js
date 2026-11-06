import * as THREE from 'three';
import { soften } from './surface.js';
import { KIT, atlas, cell, strip } from './kit.js';
import { Faces } from './window.js';

// Кровля поверх тёса (тёс остаётся обрешёткой: его видно снизу под свесом и с торцов) и печная труба.
// Кровли — наборы Никиты с общими краями, плитки перемешаны по клеткам, как земля:
// шифер — 2 листа по 8 волн в ширину плитки (лист 1,13 м), волна сделана и формой, гребни там же, где на картинке;
// кровельное железо — зелёные «картины», 2 полосы по 0,7 м; рубероид — 2 полотна по 1 м.
// tile — метры плитки поперёк ската и вдоль него, lift — на сколько кровля над плоскостью ската (тёс под ней),
// ridge — какие ленты набора коньков подходят (0–1 железные, 2–3 шиферные); у рубероида конька нет —
// полотна заходят друг на друга на гребне.
// tone — во сколько светлее или темнее картинки (белёсый шифер в тени сереет, рубероид иначе выходит чёрной дырой).
export const COVERS = {
  slate: { tile: [2.26, 3.0], lift: 0.055, wave: { count: 16, crest: 23 / 48, height: 0.015 }, ridge: [2, 3], tone: 0.8 },
  metal: { tile: [1.4, 1.4], lift: 0.04, ridge: [0, 1], tone: 1 },
  felt: { tile: [2, 2], lift: 0.038, tone: 1.6 },
};
const THICK = 0.006;                         // м — толщина листа на срезах
const CAP = { half: 0.17, rise: 0.025, tile: 2.4 }; // конёк: от гребня вниз по скату, выше кровли на гребне, повтор
const LOOK = { contrast: 0.8, saturation: 0.75, scales: [0.4, 1.3], low: [0.86, 0.86, 0.86], high: [1.05, 1.04, 1.02] };
const coverMaterials = Object.fromEntries(Object.keys(COVERS).map((name) => [name,
  soften(new THREE.MeshLambertMaterial({ map: atlas(name), color: new THREE.Color().setScalar(COVERS[name].tone) }), { ...LOOK, cells: KIT[name].grid })]));
const ridgeMaterial = new THREE.MeshLambertMaterial({ map: atlas('ridge') });

// Труба: сечение (поперёк конька и вдоль), выше конька на above, оголовок шире на out и высотой height;
// плитка кирпича — 2 кирпича (0,52 м) на 6 рядов (0,45 м). Копоть — картинка набора по верху трубы.
const CHIMNEY = { size: [0.51, 0.38], above: 0.6, cap: { height: 0.15, out: 0.05 }, brick: [0.52, 0.45], soot: 0.003 };
const brickMaterial = soften(new THREE.MeshLambertMaterial({ map: atlas('brick') }), { ...LOOK, contrast: 0.85, cells: KIT.brick.grid });
const sootMaterial = new THREE.MeshLambertMaterial({ map: atlas('soot'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
const flueMaterial = new THREE.MeshLambertMaterial({ color: 0x141211 });

// Кровля kind на двускатной крыше: ridge — высота конька (линия скатов), pitch — уклон, length — длина ската
// от конька до свеса, zEnd — полудлина крыши вдоль конька.
export function buildCover(kind, { ridge, pitch, length, zEnd }, rnd) {
  const { tile, lift, wave, ridge: caps } = COVERS[kind];
  const group = new THREE.Group();
  const Z = new THREE.Vector3(0, 0, 1);
  // Волна шифера: высота над листом и её наклон вдоль z.
  const k = wave ? (2 * Math.PI * wave.count) / tile[0] : 0, phase = wave ? 2 * Math.PI * wave.crest : 0;
  const h = (z) => (wave ? wave.height * Math.cos(k * z - phase) : 0);
  const dh = (z) => (wave ? -wave.height * k * Math.sin(k * z - phase) : 0);
  const step = wave ? tile[0] / wave.count / 8 : 2 * zEnd;
  const z0 = -zEnd - 0.02, z1 = zEnd + 0.02, u0 = rnd() * 10, v0 = rnd() * 10;
  for (const s of [-1, 1]) {
    const X = new THREE.Vector3(s * Math.cos(pitch), -Math.sin(pitch), 0);
    const n = new THREE.Vector3(s * Math.sin(pitch), Math.cos(pitch), 0);
    const O = new THREE.Vector3(0, ridge, 0);
    // Скаты сходятся на гребне без щели: лист начинается там, где его плоскость встречает плоскость другого ската.
    const x0 = -lift * Math.tan(pitch), x1 = length + 0.04;
    const at = (x, z, up = 0) => O.clone().addScaledVector(X, x).addScaledVector(Z, z).addScaledVector(n, lift + h(z) + up);
    const pos = [], normal = [], uv = [], index = [];
    const cols = Math.ceil((z1 - z0) / step);
    for (let i = 0; i <= cols; i++) {
      const z = z0 + ((z1 - z0) * i) / cols, nz = n.clone().addScaledVector(Z, -dh(z)).normalize();
      for (const x of [x0, x1]) {
        pos.push(...at(x, z).toArray());
        normal.push(...nz.toArray());
        uv.push(u0 + z / tile[0], v0 + (x1 - x) / tile[1]);
      }
      if (i) {
        const a = 2 * i, b = a - 2; // b, b+1 — прошлый столбец (гребень, свес), a, a+1 — этот
        index.push(...(s < 0 ? [b, b + 1, a, a, b + 1, a + 1] : [b, a, b + 1, a, a + 1, b + 1]));
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    const sheet = new THREE.Mesh(geometry, coverMaterials[kind]);
    sheet.castShadow = sheet.receiveShadow = true;
    // Срезы листа: по свесу (волной) и по краям у фронтонов.
    const edges = new Faces();
    for (let i = 0; i < cols; i++) {
      const za = z0 + ((z1 - z0) * i) / cols, zb = z0 + ((z1 - z0) * (i + 1)) / cols;
      edges.face([at(x1, za), at(x1, zb), at(x1, zb, -THICK), at(x1, za, -THICK)].map((p) => p.toArray()), X.toArray());
    }
    for (const [z, out] of [[z0, -1], [z1, 1]]) {
      edges.face([at(x0, z), at(x1, z), at(x1, z, -THICK), at(x0, z, -THICK)].map((p) => p.toArray()), [0, 0, out]);
    }
    group.add(sheet, edges.mesh(coverMaterials[kind]));
  }
  // Конёк — согнутая лента вдоль гребня: картинка поперёк ленты, сгиб — на середине её высоты.
  if (caps) {
    const row = caps[Math.floor(rnd() * caps.length)], [u0c, v0c, u1c, v1c] = cell('ridge', row), mid = (v0c + v1c) / 2;
    const top = ridge + lift / Math.cos(pitch) + (wave?.height ?? 0) + CAP.rise;
    const faces = new Faces();
    for (const s of [-1, 1]) {
      const X = new THREE.Vector3(s * Math.cos(pitch), -Math.sin(pitch), 0), n = new THREE.Vector3(s * Math.sin(pitch), Math.cos(pitch), 0);
      const edge = new THREE.Vector3(0, ridge, 0).addScaledVector(X, CAP.half).addScaledVector(n, lift + (wave?.height ?? 0) + 0.004);
      // Левый скат берёт нижнюю половину картинки (низ — у края), правый — верхнюю (верх — у края).
      const rect = s < 0 ? [u0c, v0c, u1c, mid] : [u0c, mid, u1c, v1c];
      const at = (t, hh) => ((s < 0 ? hh : 1 - hh) ? new THREE.Vector3(0, top, z0 + t) : edge.clone().setZ(z0 + t)).toArray();
      strip(faces, rect, z1 - z0, CAP.tile, at, n.toArray());
    }
    group.add(faces.mesh(ridgeMaterial));
  }
  return group;
}

// Печная труба на одном из скатов крыши ridge/pitch, у конька; zEnd — полудлина крыши.
export function buildChimney({ ridge, pitch, zEnd }, rnd) {
  const { size: [wx, wz], above, cap, brick, soot } = CHIMNEY;
  const cx = (rnd() < 0.5 ? -1 : 1) * (0.35 + 0.5 * rnd()), cz = (rnd() - 0.5) * zEnd * 0.8;
  const top = ridge + above, neck = top - cap.height;
  // Низ — под скатом с запасом: снаружи его не видно, а труба нигде не висит над кровлей.
  const bottom = ridge - (Math.abs(cx) + wx / 2 + 0.1) * Math.tan(pitch) - 0.3;
  const bricks = new Faces(), sootFaces = new Faces(), flue = new Faces();
  const sootCell = cell('soot', Math.floor(rnd() * KIT.soot.count));
  const [su0, sv0, su1, sv1] = sootCell, square = Math.max(wx, wz) + 2 * cap.out;
  const sootV = (y) => sv1 - ((top - y) / square) * (sv1 - sv0);
  let u = rnd() * 10;
  // Четыре стенки коробки шириной 2·hx × 2·hz от y0 до y1; копоть — квадрат картинки со стороной в ширину
  // оголовка, верхом у top, отступ от стенки — soot.
  const box = (hx, hz, y0, y1) => {
    const sides = [[[-hx, hz], [hx, hz], [0, 0, 1]], [[hx, hz], [hx, -hz], [1, 0, 0]], [[hx, -hz], [-hx, -hz], [0, 0, -1]], [[-hx, -hz], [-hx, hz], [-1, 0, 0]]];
    for (const [[ax, az], [bx, bz], nrm] of sides) {
      const width = Math.hypot(bx - ax, bz - az), p = (x, z, y, d = 0) => [cx + x + nrm[0] * d, y, cz + z + nrm[2] * d];
      bricks.face([p(ax, az, y0), p(bx, bz, y0), p(bx, bz, y1), p(ax, az, y1)], nrm,
        [[u, y0 / brick[1]], [u + width / brick[0], y0 / brick[1]], [u + width / brick[0], y1 / brick[1]], [u, y1 / brick[1]]]);
      u += width / brick[0];
      const ys = Math.max(y0, top - square);
      if (y1 > ys) sootFaces.face([p(ax, az, ys, soot), p(bx, bz, ys, soot), p(bx, bz, y1, soot), p(ax, az, y1, soot)], nrm,
        [[su0, sootV(ys)], [su1, sootV(ys)], [su1, sootV(y1)], [su0, sootV(y1)]]);
    }
  };
  box(wx / 2, wz / 2, bottom, neck);
  box(wx / 2 + cap.out, wz / 2 + cap.out, neck, top);
  // Оголовок снизу и сверху; сверху — чёрная от сажи плита.
  const hx = wx / 2 + cap.out, hz = wz / 2 + cap.out;
  flue.face([[cx - hx, top, cz - hz], [cx + hx, top, cz - hz], [cx + hx, top, cz + hz], [cx - hx, top, cz + hz]], [0, 1, 0]);
  flue.face([[cx - hx, neck, cz - hz], [cx + hx, neck, cz - hz], [cx + hx, neck, cz + hz], [cx - hx, neck, cz + hz]], [0, -1, 0]);
  const sootMesh = sootFaces.mesh(sootMaterial);
  sootMesh.castShadow = false;
  return new THREE.Group().add(bricks.mesh(brickMaterial), flue.mesh(flueMaterial), sootMesh);
}

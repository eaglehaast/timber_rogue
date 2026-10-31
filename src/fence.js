import * as THREE from 'three';
import { tiles } from './surface.js';
import { generator } from './random.js';

// Забор по периметру участка W × D метров с центром в начале координат: штакетник со всех сторон,
// к дороге (z = +D/2) — с калиткой. Доски крашеные, верх углом, между ними сквозные щели: сквозь них
// чуть видно улицу, а солнце кладёт полосы на траву. Высоту, щели и тон краски подбираем клавишами.
export const YARD = { w: 60, d: 40 };
export const HEIGHTS = [1.5, 1.8, 2.1, 2.4];
export const GAPS = { узкие: [0.01, 0.02], средние: [0.02, 0.04], широкие: [0.04, 0.07] };
export const TONES = { 'как на картинке': [1, 1], выгоревший: [0.65, 1.1], 'старый серый': [0.4, 0.9] }; // насыщенность, светлота

// Картинки от ChatGPT: по 10 досок, столбов и прожилин; доски и столбы бесшовные по обеим осям,
// прожилины — по длине. Каждая деталь берёт одну из них наугад.
const KINDS = 10;
// Метров на одно повторение картинки вдоль детали: по ширине картинка ложится на доску целиком,
// а вверх растянута вдвое против своих пропорций, чтобы сучки не повторялись через каждые 30 см.
const BOARD_SPAN = 0.7, POST_SPAN = 0.6, RAIL_SPAN = 1.6;

// Тон краски общий на весь забор и меняется на ходу: насыщенность и светлота поверх картинки.
const tone = { saturation: { value: 1 }, light: { value: 1 } };
export function setTone([saturation, light]) {
  tone.saturation.value = saturation;
  tone.light.value = light;
}
function painted(map) {
  const material = new THREE.MeshLambertMaterial({ map });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.fenceSaturation = tone.saturation;
    shader.uniforms.fenceLight = tone.light;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float fenceSaturation, fenceLight;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float fenceLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(vec3(fenceLuma), diffuseColor.rgb, fenceSaturation) * fenceLight;`);
  };
  material.customProgramCacheKey = () => 'fence';
  return material;
}
const materials = Object.fromEntries(['board', 'post', 'rail'].map((name) => [name,
  tiles(Array.from({ length: KINDS }, (_, i) => `assets/textures/fence-${name}-${i + 1}.jpg`)).map(painted)]));

// Доска с верхом углом: пятиугольник шириной w и высотой h, толщиной t. Картинка лежит по ширине доски
// и повторяется вверх, начиная с места shift: соседние доски одной картинки не совпадают.
function board(w, h, t, shift) {
  const outline = [[-w / 2, 0], [w / 2, 0], [w / 2, h - w / 2], [0, h], [-w / 2, h - w / 2]];
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))),
    { depth: t, bevelEnabled: false }).translate(0, 0, -t / 2);
  const p = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / BOARD_SPAN + shift);
  return geometry;
}
// Брусок с основанием в нуле; картинка на гранях повторяется [вдоль, вверх] раз.
function block(sx, sy, sz, [along, up]) {
  const geometry = new THREE.BoxGeometry(sx, sy, sz).translate(0, sy / 2, 0);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * along, uv.getY(i) * up);
  return geometry;
}

// Детали одной картинки сливаем в одну геометрию: тысяча досок — один вызов отрисовки.
function merge(parts) {
  parts = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const arrays = parts.map((g) => g.attributes[name].array);
    const data = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    arrays.reduce((at, a) => (data.set(a, at), at + a.length), 0);
    merged.setAttribute(name, new THREE.BufferAttribute(data, parts[0].attributes[name].itemSize));
  }
  return merged;
}

// Сторона забора — отрезок от a до b по земле; деталь ставим по координате s вдоль него,
// со сдвигом off наружу участка и наклоном tilt вдоль стороны.
function side(a, b) {
  const dir = new THREE.Vector2(b.x - a.x, b.z - a.z), length = dir.length();
  dir.normalize();
  const yaw = Math.atan2(-dir.y, dir.x);
  const place = (s, off, y, tilt = 0) => new THREE.Matrix4().compose(
    new THREE.Vector3(a.x + dir.x * s - dir.y * off, y, a.z + dir.y * s + dir.x * off),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, tilt, 'YXZ')), new THREE.Vector3(1, 1, 1));
  return { length, place };
}

// Штакетник: столбы через 2,5 м, две прожилины, доски 9–14 см неровные по высоте и наклону. Изредка доски нет.
// Слепок случайностей не зависит от высоты: забор меняет её, не перетасовывая доски.
function picket({ length, place }, { height, gap: [g0, g1] }, rnd, put, gate) {
  const between = (a, b) => a + rnd() * (b - a);
  const post = height - 0.15;
  for (let s = 0; s <= length + 0.01; s += 2.5) put('post', block(0.12, post, 0.12, [1, post / POST_SPAN]).applyMatrix4(place(s, 0, 0)));
  for (const y of [0.3, height - 0.45]) put('rail', block(length, 0.08, 0.05, [length / RAIL_SPAN, 1]).applyMatrix4(place(length / 2, 0.06, y)));
  for (let s = 0.05; s < length - 0.05;) {
    const w = between(0.09, 0.14), mid = s + w / 2, inGate = gate !== undefined && Math.abs(mid - gate) < 0.55;
    if (rnd() > 0.03) {
      const h = inGate ? height - 0.17 : height - between(0, 0.08);
      put('board', board(w, h, 0.022, rnd()).applyMatrix4(place(mid, 0.1, inGate ? 0.12 : 0.05, between(-0.025, 0.025))));
    }
    s += w + between(g0, g1);
  }
  if (gate === undefined) return;
  // Калитка — проём с толстыми столбами, её доски держит укосина из угла в угол.
  for (const s of [gate - 0.6, gate + 0.6]) put('post', block(0.16, height + 0.1, 0.16, [1, (height + 0.1) / POST_SPAN]).applyMatrix4(place(s, 0, 0)));
  const across = 0.9, up = height - 0.8;
  put('rail', block(0.05, Math.hypot(across, up), 0.08, [1, 1]).applyMatrix4(place(gate - across / 2, 0.07, 0.34, -Math.atan2(across, up))));
}

export function makeFence(look) {
  const root = new THREE.Group();
  const rnd = generator(7);
  const parts = { board: [], post: [], rail: [] };
  for (const name in parts) parts[name] = Array.from({ length: KINDS }, () => []);
  const put = (name, geometry) => parts[name][Math.floor(rnd() * KINDS)].push(geometry);
  const options = { height: look.height, gap: GAPS[look.gap] };
  const x = YARD.w / 2, z = YARD.d / 2;
  // Обходим участок по часовой стрелке при взгляде сверху: тогда «наружу» у каждой стороны смотрит от двора.
  picket(side({ x: -x, z }, { x, z }), options, rnd, put, x + 8);
  picket(side({ x, z }, { x, z: -z }), options, rnd, put);
  picket(side({ x, z: -z }, { x: -x, z: -z }), options, rnd, put);
  picket(side({ x: -x, z: -z }, { x: -x, z }), options, rnd, put);
  for (const name in parts) {
    parts[name].forEach((list, i) => {
      if (!list.length) return;
      const mesh = new THREE.Mesh(merge(list), materials[name][i]);
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    });
  }
  return root;
}

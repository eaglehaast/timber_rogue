import * as THREE from 'three';
import { tiles } from './surface.js';
import { generator } from './random.js';

// Забор по периметру участка W × D метров с центром в начале координат: штакетник со всех сторон,
// к дороге (z = +D/2) — с калиткой. Доски крашеные, ровные, верх углом, между ними сквозные щели: сквозь них
// чуть видно улицу, а солнце кладёт полосы на траву. Столбы — металлические трубы.
// Высоту, щели и тон краски, а у столбов — выцветание, высоту и толщину подбираем клавишами.
export const YARD = { w: 60, d: 40 };
export const HEIGHTS = [1.5, 1.8, 2.1, 2.4];
export const GAPS = { узкие: 0.015, средние: 0.03, широкие: 0.055 };
export const TONES = { 'как на картинке': [1, 1], выгоревший: [0.65, 1.1], 'старый серый': [0.4, 0.9] }; // насыщенность, светлота
export const FADES = { чёрные: 0, потёртые: 0.35, выцветшие: 0.65, серые: 0.9 }; // насколько краска столбов сошла до серого
export const POST_RISES = [-0.3, -0.15, 0, 0.15]; // м: верх столба выше (+) или ниже (−) верха досок
export const POST_WIDTHS = [0.06, 0.076, 0.108, 0.13, 0.16]; // м: диаметр трубы

// Картинки от ChatGPT: по 10 досок, труб и прожилин; доски и трубы бесшовные по обеим осям,
// прожилины — по длине. Каждая деталь берёт одну из них наугад.
const KINDS = 10;
// Метров на одно повторение картинки вдоль детали: по ширине картинка ложится на доску целиком,
// а вверх растянута вдвое против своих пропорций, чтобы сучки не повторялись через каждые 30 см.
const BOARD_SPAN = 0.7, POST_SPAN = 0.6, RAIL_SPAN = 1.6;

// Краска меняется на ходу поверх картинки: насыщенность, светлота и выцветание до серого,
// при котором рисунок картинки (ржавчина, потёртости) остаётся пятнами тона. У досок с прожилинами
// краска одна, у столбов своя.
const paint = (saturation = 1, light = 1, fade = 0) =>
  ({ saturation: { value: saturation }, light: { value: light }, fade: { value: fade } });
const boards = paint(), posts = paint();
export function setTone([saturation, light]) {
  boards.saturation.value = saturation;
  boards.light.value = light;
}
export function setFade(fade) { posts.fade.value = fade; }
function painted(map, { saturation, light, fade }) {
  const material = new THREE.MeshLambertMaterial({ map });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { fenceSaturation: saturation, fenceLight: light, fenceFade: fade });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float fenceSaturation, fenceLight, fenceFade;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float fenceLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(vec3(fenceLuma), diffuseColor.rgb, fenceSaturation) * fenceLight;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.48, 0.45) * (0.6 + 2.0 * fenceLuma), fenceFade);`);
  };
  material.customProgramCacheKey = () => 'fence';
  return material;
}
const materials = Object.fromEntries([['board', boards], ['post', posts], ['rail', boards]].map(([name, tone]) => [name,
  tiles(Array.from({ length: KINDS }, (_, i) => `assets/textures/fence-${name}-${i + 1}.jpg`)).map((map) => painted(map, tone))]));

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
// Брусок или труба с основанием в нуле; картинка на гранях повторяется [вдоль, вверх] раз.
function repeat(geometry, [along, up]) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * along, uv.getY(i) * up);
  return geometry;
}
const block = (sx, sy, sz, times) => repeat(new THREE.BoxGeometry(sx, sy, sz).translate(0, sy / 2, 0), times);
const pipe = (r, h) => repeat(new THREE.CylinderGeometry(r, r, h, 12).translate(0, h / 2, 0), [1, h / POST_SPAN]);

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

// Штакетник: трубы через 2,5 м, две прожилины, доски по 10 см ровным рядом. Наугад только картинка доски
// и с какого места она начинается, поэтому забор меняет высоту, не перетасовывая доски.
const BOARD = 0.1;
// Прожилины прикручены к трубам снаружи, доски — к прожилинам: чем толще труба, тем дальше они от её оси.
function picket({ length, place }, { height, gap, postRise, postWidth }, rnd, put, gate) {
  const nearGate = (s, half) => gate !== undefined && Math.abs(s - gate) < half;
  const r = postWidth / 2, rails = r + 0.026, front = rails + 0.037;
  for (let s = 0; s <= length + 0.01; s += 2.5) if (!nearGate(s, 0.8)) put('post', pipe(r, height + postRise).applyMatrix4(place(s, 0, 0)));
  for (const y of [0.3, height - 0.45]) put('rail', block(length, 0.08, 0.05, [length / RAIL_SPAN, 1]).applyMatrix4(place(length / 2, rails, y)));
  for (let s = 0.05; s + BOARD < length - 0.05; s += BOARD + gap) {
    const mid = s + BOARD / 2, inGate = nearGate(mid, 0.55);
    put('board', board(BOARD, inGate ? height - 0.17 : height, 0.022, rnd()).applyMatrix4(place(mid, front, inGate ? 0.12 : 0.05)));
  }
  if (gate === undefined) return;
  // Калитка — проём между трубами потолще, её доски держит укосина из угла в угол.
  for (const s of [gate - 0.6, gate + 0.6]) put('post', pipe(r * 1.2, height + postRise + 0.25).applyMatrix4(place(s, 0, 0)));
  const across = 0.9, up = height - 0.8;
  put('rail', block(0.05, Math.hypot(across, up), 0.08, [1, 1]).applyMatrix4(place(gate - across / 2, rails, 0.34, -Math.atan2(across, up))));
}

export function makeFence(look) {
  const root = new THREE.Group();
  const rnd = generator(7);
  const parts = { board: [], post: [], rail: [] };
  for (const name in parts) parts[name] = Array.from({ length: KINDS }, () => []);
  const put = (name, geometry) => parts[name][Math.floor(rnd() * KINDS)].push(geometry);
  const options = { ...look, gap: GAPS[look.gap] };
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

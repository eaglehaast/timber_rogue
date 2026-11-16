import * as THREE from 'three';
import { tiles } from './surface.js';
import { height } from './terrain.js';
import { YARD } from './fence.js';

// Предметы двора по скану айфона (Polycam, Scaniverse, Object Capture): садовая ванна, бак, колонка.
// Форма — из скана, tools/scan.mjs упрощает её до assets/models/<имя>.glb: один меш, метры, низ на нуле,
// середина основания над началом координат. Поверхность — assets/textures/scan-<имя>.webp: шесть видов предмета,
// перерисованных ChatGPT в нашем стиле и спроецированных обратно на развёртку скана (тот же tools/scan.mjs).
// Новый предмет — строка здесь: odds — с какой вероятностью он есть во дворе.
export const SCANS = [];
const GAP = 1; // м: между предметами и до всего, что занято

// Наш GLB: один меш с одним примитивом, без сжатия — так его пишет tools/scan.mjs.
const TYPES = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array };
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3 };
export async function readModel(url) {
  const data = await (await fetch(url)).arrayBuffer();
  const length = new DataView(data).getUint32(12, true), bin = 20 + length + 8;
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, length)));
  const read = (i) => {
    const a = json.accessors[i], view = json.bufferViews[a.bufferView], n = SIZES[a.type];
    return new THREE.BufferAttribute(new TYPES[a.componentType](data, bin + (view.byteOffset ?? 0) + (a.byteOffset ?? 0), a.count * n), n);
  };
  const { attributes, indices } = json.meshes[0].primitives[0];
  const geometry = new THREE.BufferGeometry().setIndex(read(indices));
  for (const [name, key] of [['position', 'POSITION'], ['normal', 'NORMAL'], ['uv', 'TEXCOORD_0']]) geometry.setAttribute(name, read(attributes[key]));
  geometry.computeBoundingBox();
  return geometry;
}

// Развёртка у glTF считается от верхнего края картинки — как и запекает её tools/scan.mjs.
const MODELS = Object.fromEntries(await Promise.all(SCANS.map(async ({ name }) => {
  const geometry = await readModel(`assets/models/${name}.glb`), map = tiles([`assets/textures/scan-${name}.webp`])[0];
  map.flipY = false;
  const { min, max } = geometry.boundingBox;
  return [name, { geometry, material: new THREE.MeshLambertMaterial({ map }), r: Math.hypot(max.x - min.x, max.z - min.z) / 2 }];
})));

// Где во дворе стоят предметы: каждый с вероятностью odds, в случайном месте, где free(x, z, r) — свободен
// круг радиусом r: основание предмета (r — радиус круга, в который оно вписано) с запасом GAP.
// Возвращает [{ name, x, z, r, yaw }].
export function planScans(rnd, free) {
  const placed = [];
  for (const { name, odds } of SCANS) {
    if (rnd() > odds) continue;
    const { r } = MODELS[name];
    for (let tries = 0; tries < 50; tries++) {
      const x = (rnd() - 0.5) * YARD.w, z = (rnd() - 0.5) * YARD.d;
      if (!free(x, z, r + GAP) || placed.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + GAP)) continue;
      placed.push({ name, x, z, r, yaw: rnd() * Math.PI * 2 });
      break;
    }
  }
  return placed;
}

// Предмет стоит ровно, а не по склону, и садится на самую низкую точку земли под основанием: на кочке
// он чуть уходит в неё, как осевший в землю, но нигде не висит.
export function buildScans(placed) {
  const group = new THREE.Group();
  for (const { name, x, z, yaw } of placed) {
    const { geometry, material } = MODELS[name], mesh = new THREE.Mesh(geometry, material);
    const { min, max } = geometry.boundingBox, c = Math.cos(yaw), s = Math.sin(yaw);
    const under = [[min.x, min.z], [max.x, min.z], [min.x, max.z], [max.x, max.z], [0, 0]].map(([a, b]) => height(x + a * c + b * s, z - a * s + b * c));
    mesh.position.set(x, Math.min(...under), z);
    mesh.rotation.y = yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

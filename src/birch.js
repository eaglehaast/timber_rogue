import * as THREE from 'three';
import { makeAxis, walk, section } from './axis.js';
import { random, seed } from './random.js';
import { tiles, soften } from './surface.js';
import { swaying, dense, depth, barkGeometry, sprayGeometry, plant } from './foliage.js';

// Берёза лесополосы (по фото Никиты): стройный ствол с лёгким наклоном, крона поднята высоко, ветви идут вверх
// и к концу поникают, с них свисают пряди — тонкие прутья с листьями. Ствол и ветви — трубки по скелету,
// как у клёна (maple.js), пряди — картинки ChatGPT, каждая своей плоскостью под своим углом: крона объёмная
// и сквозная. На ветру дерево гнётся по ветру, пряди качаются маятником, каждая в своём ритме, листья трепещут.
// Берёз в полосе сотни, поэтому вырастает по одной каждого вида, а в полосе стоят их копии (InstancedMesh)
// со своим поворотом и ростом.
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + random() * (b - a);
const wobble = (d, k) => d.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(k)).normalize();

// Виды — рост, м: взрослые, средние, молодые.
export const KINDS = [20, 19, 18, 15, 14, 13, 8, 6.5];

// Кора — плитки бересты 40 см (BARK_TILE клёна), вперемешку по всему стволу: тёмного комля Никита не хочет.
// Пряди — атлас вертикальных картинок (tools/birch.py): aspect — ширина к высоте клетки, length — длина клетки
// в метрах, kind — вид: 0 длинная прядь, 1 короткий пучок (обе свисают, крепятся сверху), 2 побег вверх (снизу).
const BARK = await (await fetch('assets/textures/birch-bark.json')).json();
const SPRAY = await (await fetch('assets/textures/birch-spray.json')).json();
const BY_KIND = [0, 1, 2].map((kind) => SPRAY.kind.flatMap((k, cell) => (k === kind ? [cell] : [])));
const [barkMap, sprayMap] = tiles(['assets/textures/birch-bark.jpg', 'assets/textures/birch-spray.webp']);

const bark = swaying(soften(new THREE.MeshLambertMaterial({ map: barkMap }), {
  contrast: 1, saturation: 0.8, scales: [0.4, 1.3], low: [0.85, 0.85, 0.83], high: [1.05, 1.05, 1.02],
  cells: BARK.cells,
}));
const spray = dense(swaying(new THREE.MeshLambertMaterial({ map: sprayMap, alphaTest: 0.5 })));
const [barkDepth, sprayDepth] = [depth(null), dense(depth(sprayMap))];

// Скелет берёзы ростом height: ствол, ветви, на ветвях веточки.
function skeleton(height) {
  const axes = [];
  const lean = rand(0, 0.07), az = rand(0, 2 * Math.PI);
  const R = 0.006 * height * rand(0.9, 1.15);
  // Ствол не палка: клонится до 4°, по высоте плавно изгибается в своей плоскости (bow) и чуть шатается.
  const turn0 = az + rand(-1.5, 1.5), bow = new THREE.Vector3(Math.cos(turn0), 0, -Math.sin(turn0));
  const waves = rand(0.6, 1.6), phase = rand(0, 2 * Math.PI), bend = rand(0.02, 0.06);
  const axis = new THREE.Vector3(Math.cos(az) * lean, 1, -Math.sin(az) * lean).normalize();
  const ctrl = walk(new THREE.Vector3(0, -0.15, 0), axis, height, 0.6,
    (d, f) => d.copy(axis).addScaledVector(bow, bend * Math.sin(2 * Math.PI * waves * f + phase)).add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(0.01)).normalize());
  // Ствол сужается к вершине, у земли раздут комлем; толщина гуляет наплывами.
  const swell = rand(0, 2 * Math.PI);
  const trunk = makeAxis(ctrl, (s, len) => Math.max(0.01, R * (1 - s / len) ** 0.8 * (1 + 0.3 * Math.exp(-s / 0.4)) * (1 + 0.05 * Math.sin(1.3 * s + swell))), {});
  axes.push(trunk);
  // Ветви по спирали почти от низа ствола (Никита: низ не лысый). Внизу (low — доля нижней трети кроны) они реже,
  // короче и отходят почти вбок, посередине кроны — длиннее всех, к макушке — круче вверх.
  const crown = height * rand(0.12, 0.22);
  let turn = rand(0, 2 * Math.PI);
  for (let s = crown; s < trunk.len - 0.6;) {
    turn += 2.4;
    const f = (s - crown) / (trunk.len - crown), low = 1 - Math.min(1, f / 0.3), at = section(trunk, s);
    const out = at.frame[0].clone().multiplyScalar(Math.cos(turn)).addScaledVector(at.frame[1], Math.sin(turn));
    const el = THREE.MathUtils.lerp(0.75, 0.35, f) + 0.35 * low + rand(-0.12, 0.12);
    const dir = at.tangent.clone().multiplyScalar(Math.cos(el)).addScaledVector(out, Math.sin(el)).normalize();
    const len = Math.min(0.2 * height, (trunk.len - s) * rand(0.3, 0.45) + 0.5) * (1 - 0.5 * low);
    const r0 = Math.min(0.04, at.r * rand(0.35, 0.55));
    // Ветвь идёт вверх, к концу клонится под своей тяжестью.
    const limb = makeAxis(walk(at.center, dir, len, Math.min(0.3, len / 3), (d, q) => wobble(d, 0.06).addScaledVector(UP, -0.3 * q * q).normalize()),
      (q, l) => Math.max(0.005, r0 * (1 - q / l) ** 0.8), { parent: trunk, attach: s, level: 1, joint: 'twig' });
    axes.push(limb);
    // Веточки на ветви — поочерёдно в стороны, поникают сильнее.
    let side = 1;
    for (let q = 0.3 * limb.len; q < limb.len - 0.2; q += rand(0.35, 0.6), side = -side) {
      const on = section(limb, q);
      const to = on.tangent.clone().multiplyScalar(Math.cos(0.7)).addScaledVector(on.frame[0], side * Math.sin(0.7)).normalize();
      const l = rand(0.5, 1.2) * (1 - 0.4 * (q / limb.len)), r1 = Math.max(0.004, on.r * 0.5);
      axes.push(makeAxis(walk(on.center, to, l, l / 3, (d, k) => wobble(d, 0.1).addScaledVector(UP, -0.25 * k).normalize()),
        (x, L) => Math.max(0.003, r1 * (1 - x / L)), { parent: limb, attach: q, level: 2, joint: 'twig' }));
    }
    s += rand(0.35, 0.7) * Math.sqrt(height / 18) * (1 + low);
  }
  return { axes, trunk };
}

// Пряди на ветвях и веточках: где крепится (at), куда смотрит плоскость (across), куда идёт прядь (down), длина l.
// Вдоль ветвей свисают длинные пряди и короткие пучки; макушку и концы верхних ветвей венчают побеги вверх.
const LONG = 0.7; // доля длинных прядей среди свисающих
function sprays(axes, trunk, height) {
  const list = [], scale = THREE.MathUtils.clamp(height / 16, 0.6, 1);
  const add = (a, s, kind) => {
    const at = section(a, s).center, up = kind === 2, cells = BY_KIND[kind], cell = cells[Math.floor(random() * cells.length)];
    const outward = at.clone().sub(section(trunk, Math.min(trunk.len, at.y)).center).setY(0).normalize();
    const down = (up ? UP.clone() : UP.clone().negate()).addScaledVector(outward, up ? 0.4 : 0.25).normalize();
    const az = rand(0, 2 * Math.PI), across = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    across.addScaledVector(down, -across.dot(down)).normalize();
    list.push({ at, across, down, up, cell, l: SPRAY.length[cell] * scale * rand(0.8, 1.2), seed: rand(0, 2 * Math.PI) });
  };
  for (const a of axes) {
    if (a.level) for (let s = 0.2 * a.len; s <= a.len; s += rand(0.08, 0.16)) add(a, s, random() < LONG ? 0 : 1);
    if (!a.level || (a.level === 1 && a.attach > 0.75 * trunk.len)) add(a, a.len, 2);
  }
  return list;
}

// Берёза вида k: кора и пряди.
function grow(height, k) {
  seed(7919 * (k + 1));
  const { axes, trunk } = skeleton(height);
  return { bark: barkGeometry(axes.filter((a) => a.level < 2), height), spray: sprayGeometry(sprays(axes, trunk, height), height, SPRAY) };
}

// Берёзы trees = [{ x, y, z, kind, turn, scale }] — копии своего вида (plant в foliage.js).
let kinds = null;
export function plantBirches(trees) {
  kinds ??= KINDS.map(grow);
  return plant(kinds, trees, [['bark', bark, barkDepth, true], ['spray', spray, sprayDepth, false]]);
}

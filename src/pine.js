import * as THREE from 'three';
import { makeAxis, walk, section } from './axis.js';
import { random, seed } from './random.js';
import { tiles, soften } from './surface.js';
import { swaying, dense, depth, plant, barkGeometry, sprayGeometry } from './foliage.js';

// Сосна бора: прямой высокий ствол, внизу толстая серо-бурая кора в бороздах, выше тонкая рыже-медная;
// ветви мутовками (по нескольку из одного узла, узел — год роста). В бору нижние ветви отмирают от тени:
// ствол голый, кое-где торчат сухие сучки, а живая крона — только наверху, округлая, с кистями хвои на концах
// ветвей. На опушке свету больше: крона ниже и шире. Молодые сосны — конус мутовок до самой земли.
// Ствол и ветви — трубки по скелету (axis.js), хвоя — картинки ChatGPT (tools/pine.py), как у берёзы;
// в бору стоят копии одной сосны каждого вида (foliage.js).
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + random() * (b - a);
const wobble = (d, k) => d.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(k)).normalize();

// Виды: рост h, м; crown — с какой доли высоты живая крона; grey — до какой доли высоты толстая серая кора.
// 0–3 — сосны бора, 4–5 — опушечные, 6–7 — молодые, 8–10 — подрост у опушки.
export const KINDS = [
  { h: 26, crown: 0.7, grey: 0.45 }, { h: 24, crown: 0.67, grey: 0.4 }, { h: 22, crown: 0.64, grey: 0.4 }, { h: 19, crown: 0.6, grey: 0.35 },
  { h: 17, crown: 0.38, grey: 0.3 }, { h: 12, crown: 0.28, grey: 0.25 },
  { h: 6, crown: 0.1, grey: 0.12 }, { h: 3.5, crown: 0.06, grey: 0 },
  { h: 2, crown: 0.04, grey: 0 }, { h: 1.2, crown: 0.03, grey: 0 }, { h: 0.6, crown: 0.02, grey: 0 },
];
const YOUNG = 8; // м: ниже — молодая сосна, крона конусом

// Кора: плитки 40 см, группы — рыжая (верх) и серая (низ), ступень коры 0 и 1. Лапы — атлас как у берёзы:
// kind 0 — веточка с кистями (крепится концом), 1 — короткая кисть, 2 — побег вверх.
const BARK = await (await fetch('assets/textures/pine-bark.json')).json();
const SPRAY = await (await fetch('assets/textures/pine-spray.json')).json();
const BY_KIND = [0, 1, 2].map((kind) => SPRAY.kind.flatMap((k, cell) => (k === kind ? [cell] : [])));
const [barkMap, sprayMap] = tiles(['assets/textures/pine-bark.jpg', 'assets/textures/pine-spray.webp']);
const bark = swaying(soften(new THREE.MeshLambertMaterial({ map: barkMap }), {
  contrast: 1, saturation: 0.85, scales: [0.4, 1.3], low: [0.85, 0.85, 0.83], high: [1.05, 1.03, 1.0],
  cells: BARK.cells, blend: { map: barkMap, scale: [1, 1], groups: BARK.groups },
}));
const spray = dense(swaying(new THREE.MeshLambertMaterial({ map: sprayMap, alphaTest: 0.5 })));
const [barkDepth, sprayDepth] = [depth(null), dense(depth(sprayMap))];
const PARTS = [['bark', bark, barkDepth, true], ['spray', spray, sprayDepth, false]];
// Дальше FAR метров сосна попроще: ствол и толстые ветви редкими кольцами, хвои втрое меньше, но кисти крупнее.
const FAR = { distance: 45, parts: [['barkFar', bark, barkDepth, true], ['sprayFar', spray, sprayDepth, false]] };

// Скелет сосны вида { h, crown }: ствол, сухие сучки ниже кроны, ветви мутовками, на ветвях веточки.
function skeleton({ h, crown }) {
  const axes = [], young = h < YOUNG;
  // Ствол почти прямой: клонится до 2°, чуть изогнут, у земли раздут корневыми лапами.
  const lean = rand(0, 0.035), az = rand(0, 2 * Math.PI), bend = rand(0.01, 0.03), waves = rand(0.5, 1.2), phase = rand(0, 2 * Math.PI);
  const axis = new THREE.Vector3(Math.cos(az) * lean, 1, -Math.sin(az) * lean).normalize();
  const bow = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
  const R = (0.0085 * h + 0.005) * rand(0.9, 1.1);
  const trunk = makeAxis(walk(new THREE.Vector3(0, -0.15, 0), axis, h, Math.min(0.6, h / 4),
    (d, f) => d.copy(axis).addScaledVector(bow, bend * Math.sin(2 * Math.PI * waves * f + phase)).add(new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(0.006)).normalize()),
  (s, len) => Math.max(0.004, R * (1 - s / len) ** 0.7 * (1 + 0.25 * Math.exp(-s / (0.02 * h + 0.1)))), {});
  axes.push(trunk);
  // Узлы мутовок — через годовой прирост: у молодых чаще, у взрослых до 0,6 м.
  const node = () => Math.min(0.6, 0.15 + 0.05 * h) * rand(0.7, 1.3);
  const out = (at, turn) => at.frame[0].clone().multiplyScalar(Math.cos(turn)).addScaledVector(at.frame[1], Math.sin(turn));
  const start = crown * trunk.len, reach = young ? 0.38 * h : crown > 0.5 ? 0.15 * h : 0.22 * h;
  for (let s = young ? 0.08 * h : 0.25 * h, turn = rand(0, 7); s < trunk.len - 0.6 * node(); s += node()) {
    const at = section(trunk, s);
    turn += rand(0.6, 1.6);
    if (s < start) {
      // Сухие сучки: короткие, серые, торчат вбок и чуть вниз, без хвои.
      if (random() < 0.45) for (let k = Math.ceil(rand(0, 2)); k > 0; k--) {
        const dir = at.tangent.clone().multiplyScalar(-0.15).add(out(at, turn + k * 2.1)).normalize();
        const len = rand(0.15, 0.6) * Math.min(1, h / 15), r0 = Math.min(0.025, at.r * 0.2);
        axes.push(makeAxis([at.center.clone(), at.center.clone().addScaledVector(dir, len)], (q, l) => Math.max(0.004, r0 * (1 - 0.7 * q / l)),
          { parent: trunk, attach: s, level: 1, joint: 'twig', dead: true }));
      }
      continue;
    }
    // Взрослая крона неровная: часть мутовок пропущена, и в ней меньше ветвей, чем у молодой.
    if (!young && random() < 0.3) continue;
    const f = (s - start) / (trunk.len - start);
    const count = young ? Math.round(rand(3, 5)) : Math.round(rand(2, 3.6));
    for (let k = 0; k < count; k++) {
      const el = THREE.MathUtils.lerp(young ? 1.35 : 1.5, 0.65, f) + rand(-0.15, 0.15);
      const dir = at.tangent.clone().multiplyScalar(Math.cos(el)).addScaledVector(out(at, turn + (k * 2 * Math.PI) / count + rand(-0.3, 0.3)), Math.sin(el)).normalize();
      // Молодая — конус: ветви короче к макушке; взрослая — купол.
      const len = Math.max(0.12, reach * (young ? 1 - f : 1 - f ** 1.6) * rand(0.75, 1.15));
      const r0 = Math.min(0.06, at.r * rand(0.35, 0.5));
      // Ветвь идёт вбок, к концу загибается вверх — так растут сосновые ветви.
      const limb = makeAxis(walk(at.center, dir, len, Math.min(0.3, len / 3), (d, q) => wobble(d, 0.05).addScaledVector(UP, 0.35 * q * q - 0.05).normalize()),
        (q, l) => Math.max(0.004, r0 * (1 - q / l) ** 0.8), { parent: trunk, attach: s, level: 1, joint: 'twig' });
      axes.push(limb);
      // Веточки на длинных ветвях — поочерёдно в стороны и чуть вверх.
      if (len < 0.8) continue;
      let side = 1;
      for (let q = 0.3 * len; q < len - 0.25; q += rand(0.35, 0.55), side = -side) {
        const on = section(limb, q);
        const to = on.tangent.clone().multiplyScalar(Math.cos(0.8)).addScaledVector(on.frame[0], side * Math.sin(0.8)).addScaledVector(UP, 0.15).normalize();
        const l = rand(0.4, 0.9) * Math.min(1, len / 3) * (1 - 0.4 * (q / len)), r1 = Math.max(0.004, on.r * 0.5);
        axes.push(makeAxis(walk(on.center, to, l, l / 2, (d) => wobble(d, 0.08).addScaledVector(UP, 0.1).normalize()),
          (x, L) => Math.max(0.003, r1 * (1 - x / L)), { parent: limb, attach: q, level: 2, joint: 'twig' }));
      }
    }
  }
  return { axes, trunk };
}

// Хвоя кистями на внешней части ветвей и веточек (у ствола ветви голые): веточки с кистями тянутся вдоль ветви наружу и вверх,
// короткие кисти — между ними, на концах — побеги вверх. Макушку венчает побег.
function sprays(axes, trunk, h) {
  const list = [], scale = THREE.MathUtils.clamp(h / 10, 0.22, 1);
  const add = (a, s, kind) => {
    const on = section(a, s), cells = BY_KIND[kind], cell = cells[Math.floor(random() * cells.length)];
    const down = kind === 2 ? UP.clone().addScaledVector(on.tangent, 0.5).normalize() : on.tangent.clone().addScaledVector(UP, rand(0.1, 0.5)).normalize();
    const across = wobble(new THREE.Vector3(), 1);
    across.addScaledVector(down, -across.dot(down)).normalize();
    list.push({ at: on.center, across, down, up: kind === 2, cell, l: SPRAY.length[cell] * scale * rand(0.8, 1.2), seed: rand(0, 2 * Math.PI) });
  };
  for (const a of axes) {
    if (a.dead || !a.level) continue;
    const from = a.level === 2 ? 0.1 : a.children.length ? 0.5 : 0.3;
    for (let s = from * a.len; s < a.len; s += rand(0.07, 0.13) * scale) add(a, s, random() < 0.6 ? 0 : 1);
    add(a, a.len, 2);
  }
  add(trunk, trunk.len, 2);
  return list;
}

// Сосна вида k: кора и хвоя. Кора толстая серая снизу до grey высоты, выше рыжая; ветви рыжие, сухие сучки серые.
// Трубками — ствол, сучки и ветви толще LIMB (издали — толще LIMB_FAR): тонкие веточки в хвое не видны, а сосен в бору тысяча.
const LIMB = 0.015, LIMB_FAR = 0.03;
function grow(kind, k) {
  seed(6007 * (k + 1));
  const { axes, trunk } = skeleton(kind);
  const top = kind.grey * trunk.len;
  const grade = (a, s) => (a.dead ? 1 : a.level ? 0 : 1 - THREE.MathUtils.smoothstep(s, top, top + 1.5));
  const tubes = (limb) => axes.filter((a) => !a.level || (a.level === 1 && !a.dead && a.points[0].r >= limb));
  const list = sprays(axes, trunk, kind.h);
  return {
    bark: barkGeometry([...tubes(LIMB), ...axes.filter((a) => a.dead)], kind.h, { grade }),
    spray: sprayGeometry(list, kind.h, SPRAY),
    barkFar: barkGeometry(tubes(LIMB_FAR), kind.h, { grade, coarse: 3 }),
    sprayFar: sprayGeometry(list.filter((_, i) => i % 3 === 0).map((k) => ({ ...k, l: 1.6 * k.l })), kind.h, SPRAY),
  };
}

// Сосны trees = [{ x, y, z, kind, turn, scale }] — копии своего вида (foliage.js).
let kinds = null;
export function plantPines(trees) {
  kinds ??= KINDS.map(grow);
  return plant(kinds, trees, PARTS, FAR);
}

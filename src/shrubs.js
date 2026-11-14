import * as THREE from 'three';
import { makeAxis, walk, section } from './axis.js';
import { random, seed } from './random.js';
import { tiles, soften } from './surface.js';
import { swaying, dense, depth, barkGeometry, sprayGeometry, plant } from './foliage.js';

// Кусты заречья (картинки ChatGPT, tools/hills.py) собраны, как берёза (birch.js): стволики и ветви — трубки по скелету,
// на ветвях — веточки-картинки, каждая своей плоскостью. Веточки торчат вверх и наружу: крепятся нижним краем.
// Облепиха — куст-деревце в 1–4 м: из одного места расходятся вверх несколько стволиков, ветви на них идут вверх и вбок.
// Шиповник — 1–2 м: из корня дугами выходят плети и клонятся концами наружу и вниз.
// Кустов на склоне сотни: вырастает по одному каждого вида, на склоне стоят их копии (plant в foliage.js).
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + random() * (b - a);
const wobble = (d, k) => d.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(k)).normalize();

// Виды — рост, м. Облепиха: взрослые, средние, молодая поросль; шиповник: большой, средний, маленький.
export const SEABUCKTHORN = [4, 3.2, 2.5, 1.7, 1.1], ROSEHIP = [1.8, 1.4, 1];
// Ягоды: облепиха на склоне осенью почти вся в ягодах; на шиповнике — плоды, а цветков к концу лета мало.
const FRUIT = { seabuckthorn: 0.7, rosehip: 0.9 };

// tint — во сколько раз темнее и какого тона листва на склоне, чем на картинке (там она светлая, почти серебряная).
async function look(name, groups, tint) {
  const [BARK, SPRAY] = await Promise.all(['bark', 'spray'].map(async (part) => (await fetch(`assets/textures/${name}-${part}.json`)).json()));
  const [barkMap, sprayMap] = tiles([`assets/textures/${name}-bark.jpg`, `assets/textures/${name}-spray.webp`]);
  // Ступени коры (blend, как у сосны): 0 — старые стволики, 1 — молодые ветви. У шиповника одна группа.
  const blend = groups && { map: barkMap, scale: [1, 1], groups: BARK.groups };
  const bark = swaying(soften(new THREE.MeshLambertMaterial({ map: barkMap }), {
    contrast: 1, saturation: 0.85, scales: [0.4, 1.3], low: [0.85, 0.85, 0.83], high: [1.05, 1.03, 1], cells: BARK.cells, blend }));
  const spray = dense(swaying(new THREE.MeshLambertMaterial({ map: sprayMap, alphaTest: 0.5, color: new THREE.Color(...tint) })));
  const byKind = [0, 1].map((kind) => SPRAY.kind.flatMap((k, cell) => (k === kind ? [cell] : [])));
  return { SPRAY, byKind, parts: [['bark', bark, depth(null), true], ['spray', spray, dense(depth(sprayMap)), false]] };
}
const LOOK = { seabuckthorn: await look('seabuckthorn', true, [0.75, 0.82, 0.68]), rosehip: await look('rosehip', false, [1, 1, 1]) };

// Облепиха ростом h — деревце с густой округлой кроной (Никита, 2026-11-14: прежняя — голые стволики с веером
// крупных веточек — «инопланетное растение»). Из одного места расходятся 2–4 стволика (молодая — 1–2), с трети
// высоты на них по спирали ветви: внизу длиннее и положе, к макушке короче и круче, концы загибаются вверх.
// На ветвях поочерёдно короткие побеги — на них и висит листва. Вместе ветви очерчивают шар кроны.
function seabuckthorn(h) {
  const axes = [], stems = h > 2 ? Math.round(rand(2, 4)) : Math.round(rand(1, 2));
  let az = rand(0, 2 * Math.PI);
  for (let i = 0; i < stems; i++, az += (2 * Math.PI) / stems + rand(-0.5, 0.5)) {
    const out = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)), lean = rand(0.15, 0.45);
    const dir = UP.clone().multiplyScalar(Math.cos(lean)).addScaledVector(out, Math.sin(lean));
    const len = h * rand(0.8, 1), r0 = 0.014 * h * rand(0.8, 1.2);
    const stem = makeAxis(walk(out.clone().multiplyScalar(rand(0, 0.1)).setY(-0.1), dir, len, len / 5, (d) => wobble(d, 0.07).addScaledVector(UP, 0.04).normalize()),
      (s, l) => Math.max(0.008, r0 * (1 - s / l) ** 0.7), {});
    axes.push(stem);
    for (let s = 0.3 * stem.len, side = rand(0, 2 * Math.PI); s < stem.len - 0.15; s += rand(0.12, 0.22) * Math.sqrt(h / 4), side += 2.4) {
      const at = section(stem, s), f = (s - 0.3 * stem.len) / (0.7 * stem.len);
      const away = at.frame[0].clone().multiplyScalar(Math.cos(side)).addScaledVector(at.frame[1], Math.sin(side));
      const el = THREE.MathUtils.lerp(1.1, 0.45, f) + rand(-0.15, 0.15);
      const to = at.tangent.clone().multiplyScalar(Math.cos(el)).addScaledVector(away, Math.sin(el)).normalize();
      const l = 0.5 * h * Math.sin(Math.PI * (0.15 + 0.85 * f) ** 0.8) * rand(0.75, 1.1) + 0.1;
      const limb = makeAxis(walk(at.center, to, l, l / 4, (d, q) => wobble(d, 0.08).addScaledVector(UP, 0.06 * q).normalize()),
        (q, L) => Math.max(0.004, Math.min(at.r * 0.6, 0.02) * (1 - q / L)), { parent: stem, attach: s, level: 1, joint: 'twig' });
      axes.push(limb);
      for (let q = 0.25 * limb.len, k = 1; q < limb.len - 0.08; q += rand(0.1, 0.18), k = -k) {
        const on = section(limb, q), tw = on.tangent.clone().multiplyScalar(Math.cos(0.65)).addScaledVector(on.frame[0], k * Math.sin(0.65)).normalize();
        const tl = rand(0.12, 0.3) * Math.min(1, h / 2.5);
        axes.push(makeAxis(walk(on.center, tw, tl, tl / 2, (d) => wobble(d, 0.12).normalize()),
          (x, L) => 0.003, { parent: limb, attach: q, level: 2, joint: 'twig' }));
      }
    }
  }
  return axes;
}

// Шиповник ростом h: густой округлый куст. Из корня дугами выходят плети, к концу клонятся наружу и вниз;
// с середины плети поочерёдно короткие побеги с листьями, поэтому куст плотный, а не веер голых плетей.
function rosehip(h) {
  const axes = [], canes = Math.round(rand(14, 22));
  for (let i = 0; i < canes; i++) {
    const az = rand(0, 2 * Math.PI), out = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)), lean = rand(0.15, 0.7);
    const dir = UP.clone().multiplyScalar(Math.cos(lean)).addScaledVector(out, Math.sin(lean));
    const len = h * rand(0.8, 1.3), droop = rand(0.5, 1.1), r0 = rand(0.007, 0.012);
    const cane = makeAxis(walk(out.clone().multiplyScalar(rand(0, 0.15)).setY(-0.05), dir, len, len / 5,
      (d, q) => wobble(d, 0.05).addScaledVector(out, 0.15 * q).addScaledVector(UP, -droop * q * q).normalize()),
    (s, l) => Math.max(0.004, r0 * (1 - 0.6 * s / l)), {});
    axes.push(cane);
    for (let s = 0.35 * cane.len, k = 1; s < cane.len - 0.1; s += rand(0.12, 0.2), k = -k) {
      const on = section(cane, s), l = rand(0.15, 0.35);
      const to = on.tangent.clone().multiplyScalar(Math.cos(0.7)).addScaledVector(on.frame[0], k * Math.sin(0.7)).normalize();
      axes.push(makeAxis(walk(on.center, to, l, l / 2, (d) => wobble(d, 0.12).normalize()), () => 0.003, { parent: cane, attach: s, level: 1, joint: 'twig' }));
    }
  }
  return axes;
}

// Веточки: вдоль ветвей (у облепихи) или плетей (у шиповника) с from доли длины, через step метров, и на концах.
// Идут по побегу и наружу от середины куста, каждая со своим разбросом; на fruit доле — ягоды или плоды.
function sprays(axes, h, { SPRAY, byKind }, fruit, from, step) {
  const list = [], scale = THREE.MathUtils.clamp(h / 5, 0.35, 0.75);
  const add = (a, s) => {
    const on = section(a, s), cells = byKind[random() < fruit ? 0 : 1], cell = cells[Math.floor(random() * cells.length)];
    const outward = on.center.clone().setY(0).normalize();
    const down = wobble(on.tangent.clone().addScaledVector(outward, 0.5).addScaledVector(UP, 0.15), 0.5);
    const across = wobble(new THREE.Vector3(), 1);
    across.addScaledVector(down, -across.dot(down)).normalize();
    list.push({ at: on.center, across, down, up: true, cell, l: SPRAY.length[cell] * scale * rand(0.6, 1.2), seed: rand(0, 2 * Math.PI) });
  };
  // Стволик облепихи и плеть шиповника в листве только на конце: листва вдоль побегов.
  for (const a of axes) {
    if (a.level || !a.children.length) for (let s = from * a.len; s < a.len; s += rand(step[0], step[1]) * scale) add(a, s);
    add(a, a.len);
  }
  return list;
}

function grow(species, h, k) {
  seed((species === 'seabuckthorn' ? 4409 : 5171) * (k + 1));
  const kit = LOOK[species];
  if (species === 'seabuckthorn') {
    const axes = seabuckthorn(h);
    return { bark: barkGeometry(axes.filter((a) => a.level < 2), h, { tile: 0.3, grade: (a) => (a.level ? 1 : 0) }), spray: sprayGeometry(sprays(axes, h, kit, FRUIT[species], 0.3, [0.09, 0.14]), h, kit.SPRAY) };
  }
  const axes = rosehip(h);
  return { bark: barkGeometry(axes.filter((a) => !a.level), h, { tile: 0.2 }), spray: sprayGeometry(sprays(axes, h, kit, FRUIT[species], 0.2, [0.1, 0.16]), h, kit.SPRAY) };
}

// Кусты list = [{ x, y, z, species, kind, turn, scale }]: species — 'seabuckthorn' или 'rosehip', kind — вид по росту.
let kinds = null;
export function plantShrubs(list) {
  kinds ??= { seabuckthorn: SEABUCKTHORN.map((h, k) => grow('seabuckthorn', h, k)), rosehip: ROSEHIP.map((h, k) => grow('rosehip', h, k)) };
  return new THREE.Group().add(...Object.keys(kinds).map((species) => plant(kinds[species], list.filter((t) => t.species === species), LOOK[species].parts)));
}

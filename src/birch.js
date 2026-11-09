import * as THREE from 'three';
import { makeAxis, walk, section } from './axis.js';
import { random, seed } from './random.js';
import { tiles, soften } from './surface.js';
import { windUniforms, GUST_GLSL } from './wind.js';

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

// Кора — плитки 40 см (BARK_TILE клёна): группы — белая береста и тёмный комель, переходят по высоте.
// Пряди — атлас вертикальных картинок (tools/birch.py): aspect — ширина к высоте клетки, length — длина клетки
// в метрах, kind — вид: 0 длинная прядь, 1 короткий пучок (обе свисают, крепятся сверху), 2 побег вверх (снизу).
const BARK = await (await fetch('assets/textures/birch-bark.json')).json();
const SPRAY = await (await fetch('assets/textures/birch-spray.json')).json();
const BY_KIND = [0, 1, 2].map((kind) => SPRAY.kind.flatMap((k, cell) => (k === kind ? [cell] : [])));
const [barkMap, sprayMap] = tiles(['assets/textures/birch-bark.jpg', 'assets/textures/birch-spray.webp']);

// Ветер в вершинном шейдере: сдвиг в метрах мира переводим в координаты копии (поворот и масштаб копии).
// bend — плечо изгиба дерева в точке, м; hang — от места крепления пряди, м; seed — свой ритм пряди.
const SWAY = `
  ${GUST_GLSL}
  attribute float bend, hang, seed;
  vec3 sway(vec3 p) {
    #ifdef USE_INSTANCING
      mat4 place = modelMatrix * instanceMatrix;
    #else
      mat4 place = modelMatrix;
    #endif
    vec2 root = place[3].xz;
    float g = gust(root), t = windTime + dot(root, vec2(0.37, 0.53));
    vec2 across = vec2(-windDir.y, windDir.x);
    // Дерево клонится по ветру, в порыв сильнее, и чуть покачивается само.
    vec2 push = windDir * (0.2 * windMax * (0.2 + g) + 0.004 * sin(0.9 * t)) * bend;
    // Прядь — маятник: отходит по ветру и мотается поперёк.
    float swing = windMax * (0.4 + 2.0 * g) * (0.8 + 0.4 * sin(1.6 * t + seed)) + 0.05 * sin(1.1 * t + 2.0 * seed);
    push += (windDir * swing + across * 0.4 * swing * sin(2.3 * t + 3.0 * seed)) * hang;
    // Листья трепещут.
    push += windDir * 0.03 * (0.3 + 4.0 * windMax * g) * sin(9.0 * t + dot(p, vec3(5.3, 3.7, 4.1))) * hang;
    mat3 turn = mat3(place);
    return transpose(turn) * vec3(push.x, 0.0, push.y) / dot(turn[0], turn[0]);
  }`;
function swaying(material) {
  const prior = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior.call(material, shader, renderer);
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${SWAY}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += sway(transformed);');
  };
  material.customProgramCacheKey = () => `${key}birch`;
  return material;
}
const bark = swaying(soften(new THREE.MeshLambertMaterial({ map: barkMap }), {
  contrast: 0.8, saturation: 0.8, scales: [0.4, 1.3], low: [0.85, 0.85, 0.83], high: [1.05, 1.05, 1.02],
  cells: BARK.cells, blend: { map: barkMap, scale: [1, 1], groups: BARK.groups },
}));
// Издали мип-уровни усредняют тонкие листья с прозрачным фоном, прозрачность растёт, и альфа-тест съедает крону.
// Поэтому прозрачность поднимаем с каждым мип-уровнем: на сколько уровней картинка ужата на экране.
function dense(material) {
  const prior = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      vec2 texels = max(abs(dFdx(vMapUv)), abs(dFdy(vMapUv))) * vec2(textureSize(map, 0));
      diffuseColor.a *= 1.0 + 0.25 * max(0.0, log2(max(texels.x, texels.y)));
      #include <alphatest_fragment>`);
  };
  material.customProgramCacheKey = () => `${key}dense`;
  return material;
}
const spray = dense(swaying(new THREE.MeshLambertMaterial({ map: sprayMap, alphaTest: 0.5 })));
const depth = (map) => swaying(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: map ? 0.5 : 0 }));
const [barkDepth, sprayDepth] = [depth(null), dense(depth(sprayMap))];

// Скелет берёзы ростом height: ствол, ветви, на ветвях веточки.
function skeleton(height) {
  const axes = [];
  const lean = rand(0, 0.07), az = rand(0, 2 * Math.PI);
  const R = 0.006 * height * rand(0.9, 1.15);
  const ctrl = walk(new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(Math.cos(az) * lean, 1, -Math.sin(az) * lean).normalize(), height, 0.8,
    (d) => wobble(d, 0.025).addScaledVector(UP, 0.01).normalize());
  // Ствол сужается к вершине, у земли раздут комлем.
  const trunk = makeAxis(ctrl, (s, len) => Math.max(0.01, R * (1 - s / len) ** 0.8 * (1 + 0.3 * Math.exp(-s / 0.4))), {});
  axes.push(trunk);
  // Крона поднята: ниже — голый ствол. Ветви по спирали, внизу кроны отходят шире и длиннее, к макушке — круче вверх.
  const crown = height * rand(0.4, 0.55);
  let turn = rand(0, 2 * Math.PI);
  for (let s = crown; s < trunk.len - 0.6; s += rand(0.35, 0.7) * Math.sqrt(height / 18)) {
    turn += 2.4;
    const f = (s - crown) / (trunk.len - crown), at = section(trunk, s);
    const out = at.frame[0].clone().multiplyScalar(Math.cos(turn)).addScaledVector(at.frame[1], Math.sin(turn));
    const el = THREE.MathUtils.lerp(0.75, 0.35, f) + rand(-0.12, 0.12);
    const dir = at.tangent.clone().multiplyScalar(Math.cos(el)).addScaledVector(out, Math.sin(el)).normalize();
    const len = Math.min(0.2 * height, (trunk.len - s) * rand(0.3, 0.45) + 0.5);
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

// Кора — трубки по стволу и ветвям, редкими кольцами: берёз сотни, а издали частые кольца не видны.
// Веточки видны только прядями. Текстура в метрах: плитка TILE, по кругу — по среднему радиусу оси, вдоль — по дуге.
// blend — ступень коры (grade): 1 у тёмного комля, 0 — белая береста. bend — плечо изгиба дерева в точке.
const TILE = 0.4;
function barkGeometry(axes, height, grade) {
  const pos = [], normal = [], uv = [], blend = [], index = [];
  for (const a of axes.filter((x) => x.level < 2)) {
    const sides = THREE.MathUtils.clamp(Math.round((2 * Math.PI * a.points[0].r) / 0.05), 5, 12);
    const rings = Math.max(2, Math.ceil(a.len / (a.level ? 0.25 : 0.4)));
    const mean = a.points.reduce((m, q) => m + q.r, 0) / a.points.length;
    const start = pos.length / 3;
    for (let i = 0; i <= rings; i++) {
      const s = (i / rings) * a.len, at = section(a, s);
      for (let j = 0; j <= sides; j++) {
        const az = (j / sides) * 2 * Math.PI;
        const out = at.frame[0].clone().multiplyScalar(Math.cos(az)).addScaledVector(at.frame[1], Math.sin(az));
        pos.push(...at.center.clone().addScaledVector(out, at.r).toArray());
        normal.push(...out.toArray());
        uv.push((az * mean) / TILE, s / TILE);
        blend.push(grade(a, s));
        if (i && j < sides) {
          const c = start + i * (sides + 1) + j, p = c - (sides + 1);
          index.push(p, p + 1, c, p + 1, c + 1, c);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  const y = pos.filter((_, i) => i % 3 === 1);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('blend', new THREE.Float32BufferAttribute(blend, 1));
  geometry.setAttribute('bend', new THREE.Float32BufferAttribute(y.map((v) => Math.max(0, v) ** 2 / height), 1));
  geometry.setAttribute('hang', new THREE.Float32BufferAttribute(new Float32Array(y.length), 1));
  geometry.setAttribute('seed', new THREE.Float32BufferAttribute(new Float32Array(y.length), 1));
  geometry.setIndex(index);
  return geometry;
}

// Пряди одним куском. Плоскость с двух сторон — по паре треугольников на сторону. Нормаль — от середины кроны
// наружу и вверх: крона освещена как облако. bend у всей пряди — как в месте крепления: она висит на ветке.
function sprayGeometry(list, height) {
  const [cols, rows] = SPRAY.grid;
  const cloud = list.reduce((c, k) => c.add(k.at), new THREE.Vector3()).divideScalar(list.length);
  const pos = [], normal = [], uv = [], bend = [], hang = [], seeds = [], index = [];
  for (const { at, across, down, up, cell, l, seed: phase } of list) {
    const u0 = (cell % cols) / cols, v0 = 1 - (Math.floor(cell / cols) + 1) / rows, w = l * SPRAY.aspect;
    const n = at.clone().sub(cloud).normalize().add(UP).normalize();
    const k = pos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const from = up ? v : 1 - v; // от места крепления, доля длины
      pos.push(...at.clone().addScaledVector(across, (u - 0.5) * w).addScaledVector(down, from * l).toArray());
      normal.push(...n.toArray());
      uv.push(u0 + u / cols, v0 + v / rows);
      bend.push(Math.max(0, at.y) ** 2 / height);
      hang.push(from * l);
      seeds.push(phase);
    }
    index.push(k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('bend', new THREE.Float32BufferAttribute(bend, 1));
  geometry.setAttribute('hang', new THREE.Float32BufferAttribute(hang, 1));
  geometry.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setIndex(index);
  return geometry;
}

// Берёза вида k: кора и пряди. Кора тёмная у комля (ступень 1) и белая выше (0), граница на своей высоте.
function grow(height, k) {
  seed(7919 * (k + 1));
  const { axes, trunk } = skeleton(height);
  const black = height * rand(0.05, 0.1);
  const grade = (a, s) => (a.level ? 0 : 1 - THREE.MathUtils.smoothstep(s, black, black + 1.2));
  return { bark: barkGeometry(axes, height, grade), spray: sprayGeometry(sprays(axes, trunk, height), height) };
}

// Берёзы trees = [{ x, y, z, kind, turn, scale }]: копии своего вида, повёрнутые на turn и выросшие в scale раз.
// Копии одного вида собраны кусками по CHUNK метров вдоль x: что не попало в кадр или в тень солнца, не рисуется.
const CHUNK = 30;
let kinds = null;
export function plantBirches(trees) {
  kinds ??= KINDS.map(grow);
  const group = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), size = new THREE.Vector3();
  const chunks = Map.groupBy(trees, (t) => `${t.kind} ${Math.floor(t.x / CHUNK)}`);
  for (const mine of chunks.values()) {
    const kind = kinds[mine[0].kind];
    for (const [geometry, material, shadow] of [[kind.bark, bark, barkDepth], [kind.spray, spray, sprayDepth]]) {
      const mesh = new THREE.InstancedMesh(geometry, material, mine.length);
      mine.forEach((t, i) => mesh.setMatrixAt(i, m.compose(v.set(t.x, t.y, t.z), q.setFromAxisAngle(UP, t.turn), size.setScalar(t.scale))));
      mesh.customDepthMaterial = shadow;
      mesh.castShadow = true;
      mesh.receiveShadow = material === bark;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}

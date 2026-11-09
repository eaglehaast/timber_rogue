import * as THREE from 'three';
import { section } from './axis.js';
import { windUniforms, GUST_GLSL } from './wind.js';

// Общее у деревьев с кроной из картинок (берёза, сосна): ветер в вершинном шейдере, густота кроны издали,
// материал тени, геометрия коры и прядей, посадка копиями. Геометрия несёт атрибуты bend, hang и seed (см. SWAY).
const UP = new THREE.Vector3(0, 1, 0);

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
export function swaying(material) {
  const prior = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior.call(material, shader, renderer);
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${SWAY}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += sway(transformed);');
  };
  material.customProgramCacheKey = () => `${key}sway`;
  return material;
}
// Издали мип-уровни усредняют тонкие листья с прозрачным фоном, прозрачность растёт, и альфа-тест съедает крону.
// Поэтому прозрачность поднимаем с каждым мип-уровнем: на сколько уровней картинка ужата на экране.
export function dense(material) {
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
// Материал тени: прозрачные края картинок тень не бросают, а сама тень качается вместе с деревом.
export const depth = (map) => swaying(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: map ? 0.5 : 0 }));

// Кора — трубки по осям axes (какие оси брать, решает дерево), редкими кольцами: деревьев сотни, а издали частые
// кольца не видны. Текстура в метрах: плитка tile, по кругу — по среднему радиусу оси, вдоль — по дуге.
// bend — плечо изгиба дерева в точке. grade(a, s) — ступень коры в точке оси (атрибут blend, см. soften), если кора
// у дерева меняется по высоте. coarse — во сколько раз реже кольца и грани: так кору рисуют издали.
export function barkGeometry(axes, height, { tile = 0.4, grade = null, coarse = 1 } = {}) {
  const pos = [], normal = [], uv = [], blend = [], index = [];
  for (const a of axes) {
    const sides = THREE.MathUtils.clamp(Math.round((2 * Math.PI * a.points[0].r) / (0.05 * coarse)), 5, 12);
    const rings = Math.max(2, Math.ceil(a.len / ((a.level ? 0.25 : 0.4) * coarse)));
    const mean = a.points.reduce((m, q) => m + q.r, 0) / a.points.length;
    const start = pos.length / 3;
    for (let i = 0; i <= rings; i++) {
      const s = (i / rings) * a.len, at = section(a, s);
      for (let j = 0; j <= sides; j++) {
        const az = (j / sides) * 2 * Math.PI;
        const out = at.frame[0].clone().multiplyScalar(Math.cos(az)).addScaledVector(at.frame[1], Math.sin(az));
        pos.push(...at.center.clone().addScaledVector(out, at.r).toArray());
        normal.push(...out.toArray());
        uv.push((az * mean) / tile, s / tile);
        if (grade) blend.push(grade(a, s));
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
  if (grade) geometry.setAttribute('blend', new THREE.Float32BufferAttribute(blend, 1));
  geometry.setAttribute('bend', new THREE.Float32BufferAttribute(y.map((v) => Math.max(0, v) ** 2 / height), 1));
  geometry.setAttribute('hang', new THREE.Float32BufferAttribute(new Float32Array(y.length), 1));
  geometry.setAttribute('seed', new THREE.Float32BufferAttribute(new Float32Array(y.length), 1));
  geometry.setIndex(index);
  return geometry;
}

// Пряди одним куском: list — { at, across, down, up, cell, l, seed }, sheet — атлас прядей { grid, aspect }. Плоскость с двух сторон — по паре треугольников на сторону. Нормаль — от середины кроны
// наружу и вверх: крона освещена как облако. bend у всей пряди — как в месте крепления: она висит на ветке.
export function sprayGeometry(list, height, sheet) {
  const [cols, rows] = sheet.grid;
  const cloud = list.reduce((c, k) => c.add(k.at), new THREE.Vector3()).divideScalar(list.length);
  const pos = [], normal = [], uv = [], bend = [], hang = [], seeds = [], index = [];
  for (const { at, across, down, up, cell, l, seed: phase } of list) {
    const u0 = (cell % cols) / cols, v0 = 1 - (Math.floor(cell / cols) + 1) / rows, w = l * sheet.aspect;
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

// Посадка копиями. kinds[k] — геометрии вида k по именам, trees = [{ x, y, z, kind, turn, scale }]: копия своего вида,
// повёрнутая на turn вокруг вертикали (или на rotation — Quaternion) и выросшая в scale раз. parts — что сажать:
// [[имя геометрии, материал, материал тени, принимает ли тень], …]. Копии одного вида собраны в квадраты по CHUNK метров:
// что не попало в кадр или в тень солнца, не рисуется. far = { distance, parts } — как рисовать квадрат дальше distance
// метров от камеры (THREE.LOD): деревья попроще, когда их в лесу тысяча.
const CHUNK = 30;
export function plant(kinds, trees, parts, far = null) {
  const group = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), size = new THREE.Vector3();
  const place = (mine, list, at) => new THREE.Group().add(...list.map(([name, material, shadow, receive]) => {
    const mesh = new THREE.InstancedMesh(kinds[mine[0].kind][name], material, mine.length);
    mine.forEach((t, i) => mesh.setMatrixAt(i, m.compose(v.set(t.x - at.x, t.y, t.z - at.z), t.rotation ?? q.setFromAxisAngle(UP, t.turn), size.setScalar(t.scale))));
    mesh.customDepthMaterial = shadow;
    mesh.castShadow = true;
    mesh.receiveShadow = receive;
    mesh.computeBoundingSphere();
    return mesh;
  }));
  for (const mine of Map.groupBy(trees, (t) => `${t.kind} ${Math.floor(t.x / CHUNK)} ${Math.floor(t.z / CHUNK)}`).values()) {
    if (!far) {
      group.add(place(mine, parts, { x: 0, z: 0 }));
      continue;
    }
    const at = { x: (Math.floor(mine[0].x / CHUNK) + 0.5) * CHUNK, z: (Math.floor(mine[0].z / CHUNK) + 0.5) * CHUNK };
    const lod = new THREE.LOD().addLevel(place(mine, parts, at), 0).addLevel(place(mine, far.parts, at), far.distance);
    lod.position.set(at.x, 0, at.z);
    group.add(lod);
  }
  return group;
}

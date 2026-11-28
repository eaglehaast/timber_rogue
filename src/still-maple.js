import * as THREE from 'three';
import { windUniforms, GUST_GLSL } from './wind.js';

// Нетронутый клён издали: кора всех его веток одной сеткой и листва одной сеткой — два вызова отрисовки
// вместо двух-трёх на каждую из десятков веток (Limb). Ветки остаются как были, их сетки только спрятаны:
// подошёл игрок — склейку убирают и ветки снова рисуются сами (их можно пилить и ломать).
// Крона качается на сгибе ствола так же, как в stand (main.js), но в вершинном шейдере: угол — порыв в
// основании дерева (gust), делённый на плечо arm (высота центра тяжести над сгибом). У каждой вершины
// кроны в атрибуте pivot — сгиб её ствола (w = 1); у нижних ветвей w = 0, они стоят.
// Тень склейки не качается: шейдер теней у неё обычный.

// crowns — по стволу: { pivot: Vector3 (сгиб в осях дерева), limbs }, lows — нижние ветви. Сетки веток —
// в осях дерева (корня), как их и рисуют группы веток в покое.
export function glueMaple({ crowns, lows, base, arm, materials }) {
  const pieces = [
    ...crowns.flatMap(({ pivot, limbs }) => limbs.map((limb) => ({ limb, pivot, w: 1 }))),
    ...lows.map((limb) => ({ limb, pivot: new THREE.Vector3(), w: 0 })),
  ];
  const bark = glue(pieces.map(({ limb, pivot, w }) => ({ geometry: limb.meshes[0].geometry, pivot, w, bark: true })));
  const leaves = glue(pieces.map(({ limb, pivot, w }) => ({ geometry: limb.meshes[1].geometry, pivot, w, bark: false })));
  const sway = { swayBase: { value: new THREE.Vector2(base.x, base.z) }, swayArm: { value: arm } };
  const meshes = [new THREE.Mesh(bark, swaying(materials.bark, sway, false)), new THREE.Mesh(leaves, swaying(materials.leaf, sway, true))];
  for (const mesh of meshes) mesh.castShadow = mesh.receiveShadow = true;
  return meshes;
}

// Материалы склейки: копии коры веток и листвы с качанием. Делают их раз на дерево (у коры свой сдвиг узора).
export function stillMaterials(bark, leaf) {
  const copy = (m) => {
    const c = m.clone();
    c.onBeforeCompile = m.onBeforeCompile;
    c.customProgramCacheKey = m.customProgramCacheKey;
    return c;
  };
  return { bark: copy(bark), leaf: copy(leaf) };
}

// Сетки одного вида в одну. У коры берём только саму кору (первую группу): торцы у нетронутых веток —
// только на стыках кроны с её отломными ветвями (art-fall.js), внутри коры, их не видно.
function glue(list) {
  const names = Object.keys(list[0].geometry.attributes);
  const ranges = list.map(({ geometry }) => {
    const index = geometry.index.array;
    const g = geometry.groups[0];
    return { index, start: g ? g.start : 0, count: g ? g.count : index.length };
  });
  const verts = list.reduce((n, { geometry }) => n + geometry.attributes.position.count, 0);
  const count = ranges.reduce((n, r) => n + r.count, 0);
  const attributes = Object.fromEntries(names.map((name) => {
    const size = list[0].geometry.attributes[name].itemSize;
    return [name, { size, array: new Float32Array(verts * size) }];
  }));
  const pivot = new Float32Array(verts * 4), index = new Uint32Array(count);
  let v = 0, i = 0;
  list.forEach(({ geometry, pivot: p, w }, n) => {
    for (const name of names) {
      const from = geometry.attributes[name];
      if (!from || from.itemSize !== attributes[name].size || from.isInterleavedBufferAttribute) {
        throw new Error(`glueMaple: у сетки ${n} атрибут ${name} не такой, как у первой`);
      }
      attributes[name].array.set(from.array.subarray(0, from.count * from.itemSize), v * from.itemSize);
    }
    const k = geometry.attributes.position.count;
    for (let q = 0; q < k; q++) pivot.set([p.x, p.y, p.z, w], (v + q) * 4);
    const { index: from, start, count: c } = ranges[n];
    for (let q = 0; q < c; q++) index[i++] = from[start + q] + v;
    v += k;
  });
  const geometry = new THREE.BufferGeometry();
  for (const name of names) geometry.setAttribute(name, new THREE.BufferAttribute(attributes[name].array, attributes[name].size));
  geometry.setAttribute('pivot', new THREE.BufferAttribute(pivot, 4));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// Поворот вокруг оси UP × направление ветра (как setFromAxisAngle в stand) по формуле Родрига.
const SWAY_GLSL = `
  attribute vec4 pivot;
  uniform vec2 swayBase;
  uniform float swayArm;
  vec3 swayTurn(vec3 v) {
    float a = pivot.w * gust(swayBase) * windMax / swayArm;
    vec3 k = vec3(windDir.y, 0.0, -windDir.x);
    return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a));
  }`;

function swaying(material, sway, hasGust) {
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, windUniforms, sway);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${hasGust ? '' : GUST_GLSL}
        ${SWAY_GLSL}
        void main() {`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal = swayTurn(objectNormal);`)
      .replace('#include <project_vertex>', `transformed = pivot.xyz + swayTurn(transformed - pivot.xyz);
        #include <project_vertex>`);
  };
  material.customProgramCacheKey = () => `${key()}-still`;
  return material;
}

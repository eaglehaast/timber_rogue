import * as THREE from 'three';

// Поверхности из бесшовных фотографий: кора, трава. Картинки ложатся плиткой в мировом масштабе.
const loader = new THREE.TextureLoader();
export const tiles = (files) => files.map((file) => {
  const texture = loader.load(file);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
});

// Фотографическая текстура в игре слишком резкая и пёстрая: мелкая контрастная рябь мерцает и укачивает,
// а повтор плитки бросается в глаза. Поэтому фактуру смягчаем к среднему цвету картинки (его даёт
// самый мелкий мип-уровень), гасим насыщенность и кладём поверх крупные пятна тона — плавный шум
// по координатам текстуры двух размеров, scales — сколько ячеек шума на плитку. Пятна нигде
// не повторяются и разбивают плитку.
// cells = [столбцов, строк] — картинка не одна плитка, а набор плиток с общими краями: каждая клетка
// поверхности берёт из набора свою плитку по хешу номера клетки, так что узор не повторяется.
// blend = { map, scale, groups } — вторая картинка той же раскладки, её плитки поделены на группы подряд
// (groups — сколько плиток в каждой). Атрибут blend геометрии ведёт вершину по ступеням: 0 — плитки первой
// группы, 1 — второй, …, groups.length — первая картинка map; между ступенями — смесь соседних.
// Координаты второй картинки — координаты map, умноженные на scale. Переход между ступенями: sharp — во сколько
// раз он круче (1 — ровно на шаг ступени), ragged = [доля, ячеек шума по u, по v] — граница рвётся пятнами
// и языками: к ступени вершины прибавлен шум, ячейки — на плитку второй картинки.
export function soften(material, { contrast, saturation, scales: [a, b], low, high, cells, blend }) {
  const vec3 = (c) => `vec3(${c.map((v) => v.toFixed(2)).join(', ')})`;
  const count = cells ? cells[0] * cells[1] : 1;
  // Номер плитки скачет на краю клетки, поэтому мип-уровень берём по производным непрерывных координат.
  // Плитку берём из [first, first + n) по хешу номера клетки. Плитки нумеруются, как лежат в картинке: слева
  // направо и сверху вниз, — а v в текстуре растёт снизу, поэтому ряд считаем от верха.
  const tile = cells ? `
    vec4 softTile(sampler2D image, vec2 uv, float first, float n) {
      const vec2 N = vec2(${cells.map((v) => v.toFixed(1)).join(', ')});
      float k = first + floor(softHash(floor(uv)) * n);
      // На полтекселя от края клетки: иначе сглаживание подмешивает соседнюю плитку атласа, и на стыках клеток тонкая линия.
      vec2 edge = 0.5 * N / vec2(textureSize(image, 0));
      vec2 at = (vec2(mod(k, N.x), N.y - 1.0 - floor(k / N.x)) + clamp(fract(uv), edge, 1.0 - edge)) / N;
      return textureGrad(image, at, dFdx(uv) / N, dFdy(uv) / N);
    }` : `
    vec4 softTile(sampler2D image, vec2 uv, float first, float n) { return texture2D(image, uv); }`;
  const second = blend ? `vMapUv * vec2(${blend.scale.map((v) => v.toFixed(3)).join(', ')})` : '';
  const steps = blend ? blend.groups.map((n, i) => {
    const first = blend.groups.slice(0, i).reduce((x, y) => x + y, 0);
    const tex = `softTile(blendMap, ${second}, ${first.toFixed(1)}, ${n.toFixed(1)})`;
    return i ? `c = mix(c, ${tex}, softStep(${(i - 1).toFixed(1)}));` : `vec4 c = ${tex};`;
  }).join('\n      ') : '';
  const [torn, tu, tv] = blend?.ragged ?? [0, 1, 1];
  const pick = blend ? `
    float softStep(float i) {
      float b = vBlend + ${torn.toFixed(2)} * (softNoise(${second} * vec2(${tu.toFixed(2)}, ${tv.toFixed(2)})) - 0.5);
      return clamp((b - i - 0.5) * ${(blend.sharp ?? 1).toFixed(2)} + 0.5, 0.0, 1.0);
    }
    vec4 softPick() {
      ${steps}
      return mix(c, softTile(map, vMapUv, 0.0, ${count.toFixed(1)}), softStep(${(blend.groups.length - 1).toFixed(1)}));
    }` : '';
  const last = blend ? `softStep(${(blend.groups.length - 1).toFixed(1)})` : '';
  const mean = blend ? `mix(textureLod(blendMap, ${second}, 12.0), textureLod(map, vMapUv, 12.0), ${last})` : 'textureLod(map, vMapUv, 12.0)';
  const sample = THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', blend ? 'softPick()' : `softTile(map, vMapUv, 0.0, ${count.toFixed(1)})`);
  material.onBeforeCompile = (shader) => {
    if (blend) {
      shader.uniforms.blendMap = { value: blend.map };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float blend;\nvarying float vBlend;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlend = blend;');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        float softHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float softNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(softHash(i), softHash(i + vec2(1, 0)), f.x),
                     mix(softHash(i + vec2(0, 1)), softHash(i + vec2(1, 1)), f.x), f.y);
        }`)
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>${blend ? '\nuniform sampler2D blendMap;\nvarying float vBlend;' : ''}${tile}${pick}`)
      .replace('#include <map_fragment>', `${sample}
        #ifdef USE_MAP
          vec3 softMean = ${mean}.rgb * diffuse;
          diffuseColor.rgb = mix(softMean, diffuseColor.rgb, ${contrast.toFixed(2)});
          float softLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(vec3(softLuma), diffuseColor.rgb, ${saturation.toFixed(2)});
          float tone = 0.6 * softNoise(vMapUv * ${a.toFixed(2)}) + 0.4 * softNoise(vMapUv * ${b.toFixed(2)} + 7.0);
          diffuseColor.rgb *= mix(${vec3(low)}, ${vec3(high)}, tone);
        #endif`);
  };
  // Three.js узнаёт готовую программу по тексту onBeforeCompile, а он у всех вызовов soften один:
  // без своего ключа два материала с разными настройками получили бы одну и ту же программу.
  const key = JSON.stringify([contrast, saturation, a, b, low, high, cells, blend?.scale, blend?.groups, blend?.sharp, blend?.ragged]);
  material.customProgramCacheKey = () => key;
  return material;
}

// Развёртки труб и опор — набор картинок rows штук столбиком, с общими краями: каждая клетка uv берёт свою.
// Нарисованы под игру, поэтому не смягчаем. И картинка на земле или на стене поверх поверхности (decal):
// с прозрачностью, сдвинута к камере, чтобы не мерцать с тем, на чём лежит.
export const strips = (file, rows, more = {}) => soften(new THREE.MeshLambertMaterial({ map: tiles([`assets/textures/${file}`])[0], ...more }),
  { contrast: 1, saturation: 1, scales: [0.3, 1], low: [1, 1, 1], high: [1, 1, 1], cells: [1, rows] });
export const decal = (map, more = {}) => new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, ...more });

// Детали одной картинки сливаем в одну геометрию: тысяча досок — один вызов отрисовки.
export function merge(parts) {
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

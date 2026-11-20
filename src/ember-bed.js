import * as THREE from 'three';
import { generator } from './random.js';

const DEPTH = 0.88, MAX_RISE = 0.09, RESIDUE_LIMIT = 32;
const radiusAt = (x, z) => Math.hypot(x, z / DEPTH);
const crown = (r) => Math.max(0, 1 - r * r);
function surface(x, z) {
  const c = crown(radiusAt(x, z));
  return 0.022 + c * (0.29 + 0.026 * Math.sin(7 * x + 2 * z) + 0.022 * Math.sin(5 * z - x));
}

// Непрерывный слой тлеющей мелочи виден в зазорах между крупными осколками.
function groundGeometry() {
  const positions = [], uv = [], indices = [];
  const sectors = 60, rings = 9;
  function add(x, z) {
    positions.push(x, surface(x, z), z);
    uv.push(0.44 + x * 1.1 + z * 0.32, 0.21 + z * 1.1 - x * 0.32);
  }
  add(0, 0);
  for (let ring = 1; ring <= rings; ring++) {
    for (let i = 0; i < sectors; i++) {
      const a = i * Math.PI * 2 / sectors;
      const rim = 1 + 0.047 * Math.sin(3 * a + 1) + 0.037 * Math.sin(7 * a) + 0.025 * Math.cos(13 * a);
      const r = ring / rings * rim;
      add(r * Math.cos(a), r * Math.sin(a) * DEPTH);
      const j = 1 + (ring - 1) * sectors + i, next = j - i + (i + 1) % sectors;
      if (ring === 1) indices.push(0, next, j);
      else indices.push(j - sectors, next, j, j - sectors, next - sectors, next);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  return geo;
}

// Обколотые плашки и щепки. Срезы, плечи и продольный гребень каждой головни имеют разную высоту.
const outlines = [
  [[0.7,-0.96],[1,-0.49],[0.91,0.64],[0.54,1],[-0.7,0.89],[-1,0.39],[-0.91,-0.58],[-0.48,-1]],
  [[0.82,-0.97],[1,-0.37],[0.94,0.81],[0.49,0.94],[-0.18,0.73],[-0.79,1],[-1,-0.68],[-0.42,-0.86]],
  [[0.99,-0.89],[0.8,-0.14],[1,0.33],[0.63,0.79],[-0.93,1],[-0.75,0.10],[-1,-0.61],[-0.42,-0.94]],
];
function chunkGeometry(pieces) {
  const positions = [], uv = [], layers = [], artwork = [], indices = [];
  for (const { x, z, size, birth, lift, seed } of pieces) {
    const rnd = generator(seed);
    const slender = rnd();
    const length = size * (0.82 + slender * 0.70), width = size * (0.51 + rnd() * 0.48 - slender * 0.16);
    const h = size * (0.51 + rnd() * 0.50 - slender * 0.09), angle = rnd() * Math.PI * 2;
    const taper = (rnd() - 0.5) * 0.8, skew = rnd() - 0.5, tilt = (rnd() - 0.5) * h * 0.7;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const grainPick = rnd(), endPick = rnd();
    const grainTile = birth >= 0 && grainPick < 0.5 ? 3 : Math.floor(grainPick * 6);
    const endTile = birth >= 0 && endPick < 0.5 ? 9 : 6 + Math.floor(endPick * 4);
    const ash = rnd(), heat = rnd();
    const bedY = surface(x, z);
    const outline = outlines[Math.floor(rnd() * outlines.length)];
    const shape = outline.map(([a, b]) => [a * (0.84 + rnd() * 0.25), b * (0.79 + rnd() * 0.31), rnd()]);
    const rings = [
      shape.map(([a,b]) => [a * 0.77, b * 0.71, -0.19]),
      shape.map(([a,b,k]) => [a, b, 0.3 + k * 0.33]),
      shape.map(([a,b,k]) => [a * (0.84 + k * 0.1), b * (0.72 + k * 0.20), 0.7 + k * 0.21]),
    ];
    const ridge = [(rnd() - 0.5) * 0.66, (rnd() - 0.5) * 0.7, 0.97 + rnd() * 0.09];
    const ashTile = Math.floor(rnd() * 4), ashScale = 1.02 + rnd() * 0.57;
    const ashX = (rnd() - 0.5) * 0.29, ashY = (rnd() - 0.5) * 0.36;
    const flip = rnd() < 0.5 ? -1 : 1;

    function vertex([a, b, level], tile, side) {
      const px = (a + skew * b * 0.34) * length, pz = b * width * (1 + a * taper);
      const vx = x + px * ca - pz * sa, vz = z + px * sa + pz * ca;
      const seat = bedY + (surface(vx, vz) - bedY) * 0.68 + lift - 0.023;
      positions.push(vx, seat + level * h + a * tilt, vz);
      if (tile >= 6) uv.push(0.5 + b * 0.44 * flip, 0.18 + level * 0.76);
      else uv.push(side ? 0.20 + level * 0.72 : 0.5 + b * 0.44 * flip, 0.5 + a * 0.44);
      artwork.push(tile, 0.5 + b * ashScale * 0.5 + ashX, 0.5 + a * ashScale * 0.5 * flip + ashY, ashTile);
      layers.push(level, ash, heat, birth);
    }

    // У торца своя плоскость рисунка. Раздваиваем вершины по швам развёртки,
    // сохраняя все угольки одним объектом для отрисовки.
    const n = shape.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, midA = (shape[i][0] + shape[j][0]) / 2;
      const isEnd = Math.abs(midA) > 0.65 && Math.abs(shape[i][1] - shape[j][1]) > 0.24;
      const flankTile = heat > 0.72 && shape[i][1] * flip > 0.12 ? 3 : grainTile;
      const tile = isEnd ? endTile : flankTile;
      const start = positions.length / 3;
      for (const ring of rings) { vertex(ring[i], tile, true); vertex(ring[j], tile, true); }
      for (const lo of [start, start + 2]) indices.push(lo, lo + 2, lo + 3, lo, lo + 3, lo + 1);
    }
    const cap = positions.length / 3;
    for (const point of rings[2]) vertex(point, grainTile);
    vertex(ridge, grainTile);
    for (let i = 0; i < n; i++) indices.push(cap + n, cap + (i + 1) % n, cap + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('layer', new THREE.Float32BufferAttribute(layers, 4));
  geo.setAttribute('artwork', new THREE.Float32BufferAttribute(artwork, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// tools/coals.py подкладывает по 1/32 ячейки с каждой стороны. Тот же прямоугольник
// адресует и цвет в большом листе, и линейную маску жара в уменьшенном.
export const coalAtlasUV = `
  vec2 coalCell(float tile, vec2 uv, vec2 grid) {
    float index = floor(tile + 0.5);
    vec2 cell = vec2(mod(index, grid.x), grid.y - 1. - floor(index / grid.x));
    return (cell + 0.03125 + 0.9375 * clamp(uv, 0., 1.)) / grid;
  }`;

const vertex = `
  #include <fog_pars_vertex>
  uniform float rise, clockTime;
  varying vec2 paintUV;
  varying vec3 place;
  #ifdef CHUNKS
    attribute vec4 layer, artwork;
    varying vec4 crust;
    varying vec3 face, ashUV;
    ${coalAtlasUV}
  #endif
  void main() {
    vec3 p = position;
    vec2 radial = p.xz * vec2(1., 1.13636);
    p.y += rise * max(0., 1. - dot(radial, radial));
    #ifdef CHUNKS
      paintUV = coalCell(artwork.x, uv, vec2(4., 3.));
      ashUV = artwork.yzw;
      crust = layer;
      face = normal;
      p.y -= 0.085 * (1. - smoothstep(0., 0.72, clockTime - layer.w));
    #else
      paintUV = uv;
    #endif
    place = p;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

export const coalEmission = `
  vec3 incandescence(float mask, float temperature) {
    float intensity = pow(mask, 0.65) * (0.60 + 1.03 * temperature);
    float hot = 0.62 * mask + 0.55 * temperature;
    vec3 light = mix(vec3(0.32, 0.004, 0.012), vec3(1., 0.078, 0.009), smoothstep(0.34, 0.79, hot));
    light = mix(light, vec3(1., 0.51, 0.060), smoothstep(0.81, 1.18, hot));
    return light * intensity;
  }
`;

const fragment = `
  #include <fog_pars_fragment>
  uniform sampler2D pigment, heatMap;
  uniform float clockTime, flare;
  uniform vec2 landing;
  varying vec2 paintUV;
  varying vec3 place;
  #ifdef CHUNKS
    uniform sampler2D ashSheet;
    varying vec4 crust;
    varying vec3 face, ashUV;
  #endif
  ${coalAtlasUV}

  ${coalEmission}
  void main() {
    vec2 p = place.xz;
    float breath = 0.5 + 0.27 * sin(1.17 * clockTime + p.x * 6. + p.y * 4.)
                       + 0.23 * sin(0.73 * clockTime - p.x * 4. + p.y * 5.);
    vec2 offset = p - landing;
    float fresh = flare * exp(-dot(offset, offset) * 11.);
    float radius = length(p * vec2(1., 1.13636));
    float edge = smoothstep(0.70, 1.07, radius);
    float temperature = 0.24 + 0.41 * breath + 0.47 * fresh - 0.16 * edge;
    #ifdef CHUNKS
      vec3 n = normalize(face);
      vec3 paint = texture2D(pigment, paintUV).rgb;
      float mask = texture2D(heatMap, paintUV).r;
      float recent = exp(-max(0., clockTime - crust.w) * 0.33);
      float underside = 1. - smoothstep(0.12, 0.88, crust.x);
      float shade = 0.59 + 0.33 * max(0., dot(n, vec3(0.40, 0.83, 0.39))) + 0.12 * max(0., n.y);
      vec3 reflection = vec3(0.094, 0.012, 0.006) * underside * (0.50 + breath * 0.50) * (1. - edge);
      float exposure = 0.39 + 0.73 * underside + 0.27 * fresh + 0.35 * recent;
      vec3 color = paint * shade + reflection
                 + exposure * incandescence(mask, temperature + 0.23 * crust.z + 0.32 * underside + 0.39 * recent);
      vec4 powder = texture2D(ashSheet, coalCell(ashUV.z, ashUV.xy, vec2(2.)));
      float coat = powder.a * smoothstep(0.26, 0.89, crust.y) * smoothstep(0.47, 0.92, crust.x);
      coat *= (1. - recent * 0.89);
      color = mix(color, powder.rgb * (0.76 * shade), coat);
    #else
      // Граница между двумя нарисованными слоями неподвижна. При притоке жара
      // меняется свет в тех же щелях, древесина под ногами не перестраивается.
      float pockets = 0.15 * sin(7. * p.x + 3. * p.y) + 0.105 * cos(9. * p.y - 2. * p.x);
      float hotLayer = 1. - smoothstep(0.72, 0.94, radius + pockets);
      vec2 unit = fract(paintUV);
      vec2 coolUV = coalCell(10., unit, vec2(4., 3.)), hotUV = coalCell(11., unit, vec2(4., 3.));
      vec2 scale = vec2(0.9375 / 4., 0.9375 / 3.);
      vec2 dx = dFdx(paintUV) * scale, dy = dFdy(paintUV) * scale;
      vec3 paint = mix(textureGrad(pigment, coolUV, dx, dy).rgb, textureGrad(pigment, hotUV, dx, dy).rgb, hotLayer);
      float mask = mix(textureGrad(heatMap, coolUV, dx, dy).r, textureGrad(heatMap, hotUV, dx, dy).r, hotLayer);
      vec3 color = paint * (0.80 + 0.11 * hotLayer) + incandescence(mask, temperature + 0.40 * hotLayer);
    #endif
    gl_FragColor = vec4(color, 1.);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export function buildEmberBed({ paint, heat, ash }, rnd) {
  const root = new THREE.Group(), recent = [];
  const uniforms = {
    clockTime: { value: 0 }, rise: { value: 0 }, landing: { value: new THREE.Vector2() }, flare: { value: 0 },
    pigment: { value: paint }, heatMap: { value: heat }, ashSheet: { value: ash },
  };
  function material(chunks) {
    return new THREE.ShaderMaterial({
      fog: true, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
      defines: chunks ? { CHUNKS: 1 } : {}, vertexShader: vertex, fragmentShader: fragment,
    });
  }
  const skin = material(true), initial = [];
  // Разные калибры вперемешку. На зольной кромке остаются отдельные мелкие обломки.
  const count = 200;
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + rnd()) / count) * 1.11, a = i * 2.39996 + (rnd() - 0.5) * 0.25;
    const x = r * Math.cos(a), z = r * Math.sin(a) * DEPTH;
    // Среди крупных углей остаются два скопления крошки, сквозь них видна глубина жара.
    const pocket = Math.min(Math.hypot((x - 0.13) / 0.35, (z - 0.30) / 0.21),
                            Math.hypot((x + 0.36) / 0.22, (z + 0.18) / 0.32));
    const size = (0.061 + rnd() ** 1.45 * 0.125) * (1 - 0.52 * THREE.MathUtils.smoothstep(r, 0.78, 1.12))
               * (0.52 + 0.48 * THREE.MathUtils.smoothstep(pocket, 0, 1.2));
    initial.push({ x, z, size, lift: rnd() * size * 0.15, birth: -100, seed: rnd() * 0xffffffff });
  }
  const base = new THREE.Mesh(groundGeometry(), material(false));
  const top = new THREE.Mesh(chunkGeometry(initial), skin);
  const residue = new THREE.Mesh(new THREE.BufferGeometry(), skin);
  residue.visible = false;
  root.add(base, top, residue);
  let fill = 0;

  function ignite(x, z) {
    uniforms.landing.value.set(x, z);
    uniforms.flare.value = 1;
  }
  function deposit(x, z, mass, yaw, length) {
    // Остаток пропорционален массе и оставшемуся месту. Контур на земле всегда один.
    fill += (1 - fill) * -Math.expm1(-mass / 62);
    const n = Math.min(7, 2 + Math.ceil(Math.sqrt(mass)));
    for (let i = 0; i < n; i++) {
      const a = rnd() * 2 * Math.PI, r = rnd() * 0.11;
      const along = (i / (n - 1) - 0.5) * Math.min(0.74, length * 0.72);
      const px = x + Math.cos(yaw) * along + Math.cos(a) * r, pz = z + Math.sin(yaw) * along + Math.sin(a) * r;
      const bound = Math.max(1, radiusAt(px, pz) / 0.91);
      recent.push({
        x: px / bound, z: pz / bound, size: 0.064 + rnd() * 0.047,
        lift: 0.055 + rnd() * 0.026, birth: uniforms.clockTime.value, seed: rnd() * 0xffffffff,
      });
    }
    if (recent.length > RESIDUE_LIMIT) recent.splice(0, recent.length - RESIDUE_LIMIT);
    residue.geometry.dispose();
    residue.geometry = chunkGeometry(recent);
    residue.visible = true;
    ignite(x, z);
  }
  function tick(dt, time) {
    uniforms.clockTime.value = time;
    uniforms.rise.value += (MAX_RISE * fill - uniforms.rise.value) * -Math.expm1(-2.3 * dt);
    uniforms.flare.value *= Math.exp(-0.46 * dt);
  }
  function reset() {
    recent.length = 0;
    fill = uniforms.rise.value = uniforms.flare.value = 0;
    residue.visible = false;
    residue.geometry.dispose();
    residue.geometry = new THREE.BufferGeometry();
  }
  function heightAt(x, z) {
    return surface(x, z) + uniforms.rise.value * crown(radiusAt(x, z)) + 0.065;
  }
  return { root, ignite, deposit, tick, reset, heightAt };
}

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
  const positions = [], uv = [], layers = [], indices = [];
  for (const piece of pieces) {
    const { x, z, size, birth, lift, seed } = piece, rnd = generator(seed);
    const length = size * (0.78 + rnd() * 0.87), width = size * (0.28 + rnd() * 0.48);
    const h = size * (0.33 + rnd() * 0.69), angle = rnd() * Math.PI * 2;
    const taper = (rnd() - 0.5) * 0.8, skew = rnd() - 0.5, tilt = (rnd() - 0.5) * h * 0.7;
    const ca = Math.cos(angle), sa = Math.sin(angle), u = rnd(), v = rnd();
    const ash = rnd(), heat = rnd(), start = positions.length / 3;
    const y = surface(x, z) + lift - 0.018;
    function vertex(a, b, level) {
      const px = (a + skew * b * 0.34) * length, pz = b * width * (1 + a * taper);
      positions.push(x + px * ca - pz * sa, y + level * h + a * tilt, z + px * sa + pz * ca);
      uv.push(u + pz * 2.7 + level * h * 1.1, v + px * 1.55 + b * 0.024);
      layers.push(level, ash, heat, birth);
    }
    const outline = outlines[Math.floor(rnd() * outlines.length)];
    const shape = outline.map(([a, b]) => [a * (0.84 + rnd() * 0.25), b * (0.79 + rnd() * 0.31), rnd()]);
    for (const [a,b] of shape) vertex(a * 0.77, b * 0.71, -0.19);
    for (const [a,b,k] of shape) vertex(a, b, 0.3 + k * 0.33);
    for (const [a,b,k] of shape) vertex(a * (0.84 + k * 0.1), b * (0.62 + k * 0.25), 0.7 + k * 0.21);
    const ridge = positions.length / 3;
    vertex((rnd() - 0.5) * 0.66, (rnd() - 0.5) * 0.7, 1 + rnd() * 0.14);
    const n = shape.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      for (let band = 0; band < 2; band++) {
        const lo = start + band * n, hi = lo + n;
        indices.push(lo+i, hi+i, hi+j, lo+i, hi+j, lo+j);
      }
      indices.push(ridge, start+2*n+j, start+2*n+i);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('layer', new THREE.Float32BufferAttribute(layers, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const vertex = `
  #include <fog_pars_vertex>
  uniform float rise, clockTime;
  varying vec2 paintUV;
  varying vec3 place;
  #ifdef CHUNKS
    attribute vec4 layer;
    varying vec4 crust;
    varying vec3 face;
  #endif
  void main() {
    vec3 p = position;
    vec2 radial = p.xz * vec2(1., 1.13636);
    p.y += rise * max(0., 1. - dot(radial, radial));
    #ifdef CHUNKS
      crust = layer;
      face = normal;
      p.y -= 0.085 * (1. - smoothstep(0., 0.72, clockTime - layer.w));
    #endif
    place = p;
    paintUV = uv;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const fragment = `
  #include <fog_pars_fragment>
  uniform sampler2D pigment;
  #ifdef CHUNKS
    uniform sampler2D splinters, ashPaper;
  #endif
  uniform float clockTime, flare;
  uniform vec2 landing;
  varying vec2 paintUV;
  varying vec3 place;
  #ifdef CHUNKS
    varying vec4 crust;
    varying vec3 face;
  #endif
  void main() {
    vec3 paint = texture2D(pigment, paintUV).rgb;
    vec2 p = place.xz;
    float breath = 0.5 + 0.27 * sin(1.17 * clockTime + p.x * 6. + p.y * 4.)
                       + 0.23 * sin(0.73 * clockTime - p.x * 4. + p.y * 5.);
    vec2 offset = p - landing;
    float fresh = flare * exp(-dot(offset, offset) * 11.);
    float edge = smoothstep(0.70, 1.07, length(p * vec2(1., 1.13636)));
    #ifdef CHUNKS
      float ink = sqrt(dot(paint, vec3(0.28, 0.53, 0.19)));
      float fiber = smoothstep(0.08, 0.46, ink);
      vec3 n = normalize(face);
      // Вторая акварель вносит обрывы и пятна в горячую грань, как на расколотой головне.
      vec3 fleck = texture2D(splinters, vec2(paintUV.y, -paintUV.x) * 1.78).rgb;
      float cleft = smoothstep(0.025, 0.48, fleck.r - fleck.b);
      float ash = smoothstep(0.51, 0.99, crust.y * 0.72 + fiber * 0.41 + max(0., n.y) * 0.16);
      ash = max(ash, smoothstep(0.61, 0.92, crust.y) * smoothstep(0.42, 0.97, crust.x + fiber * 0.22));
      vec3 carbon = vec3(0.005, 0.005, 0.008) + paint * vec3(0.76, 0.74, 0.89);
      vec3 powder = texture2D(ashPaper, 0.5 + 0.27 * sin(paintUV * 6.28)).rgb;
      float flake = smoothstep(0.13, 0.64, sqrt(dot(powder, vec3(0.28, 0.53, 0.19))));
      vec3 dust = mix(vec3(0.13, 0.12, 0.15), vec3(0.59, 0.53, 0.54), 0.69 * flake + 0.31 * fiber);
      vec3 skin = mix(carbon, dust, ash * (0.64 + 0.36 * fiber));
      skin *= 0.66 + 0.32 * max(0., dot(n, vec3(0.46, 0.79, 0.40))) + 0.16 * sqrt(fleck.b);
      float newlyBroken = exp(-max(0., clockTime - crust.w) * 0.33);
      float line = 0.22 + 0.37 * crust.z + 0.11 * breath + 0.21 * fresh + 0.24 * newlyBroken - 0.26 * edge;
      float band = line - crust.x + (0.50 - fiber) * 0.48 + (cleft - 0.40) * 0.37;
      float openGrain = (1. - smoothstep(0.08, 0.21, ink)) * cleft * smoothstep(0.20, 0.70, crust.z);
      float glow = max(smoothstep(-0.15, 0.19, band), openGrain);
      float hot = clamp(0.03 + 0.38 * band + 0.16 * breath + 0.15 * crust.z + 0.38 * cleft
                        + 0.11 * fresh + 0.25 * newlyBroken - 0.22 * edge, 0., 1.);
      vec3 ember = mix(vec3(0.095, 0.003, 0.010), vec3(0.72, 0.034, 0.012), smoothstep(0.10, 0.65, hot));
      ember = mix(ember, vec3(1., 0.21, 0.018), smoothstep(0.62, 0.87, hot));
      ember = mix(ember, vec3(1., 0.58, 0.10), smoothstep(0.89, 1.0, hot));
      ember *= 0.63 + 0.22 * fiber + 0.27 * sqrt(fleck.r);
      vec3 color = mix(skin, ember, glow);
    #else
      float red = smoothstep(0.025, 0.33, paint.r - paint.b);
      vec3 color = paint * mix(0.81, (0.84 + 0.47 * breath + 0.34 * fresh) * (1. - 0.64 * edge), red);
      color.g += red * max(0., breath - 0.45) * paint.r * 0.09;
    #endif
    gl_FragColor = vec4(color, 1.);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export function buildEmberBed({ bed, char, ash }, rnd) {
  const root = new THREE.Group(), recent = [];
  bed.wrapS = bed.wrapT = THREE.MirroredRepeatWrapping;
  const uniforms = {
    clockTime: { value: 0 }, rise: { value: 0 }, landing: { value: new THREE.Vector2() }, flare: { value: 0 },
  };
  function material(pigment, chunks) {
    return new THREE.ShaderMaterial({
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms,
        pigment: { value: pigment }, splinters: { value: bed }, ashPaper: { value: ash },
      },
      defines: chunks ? { CHUNKS: 1 } : {}, vertexShader: vertex, fragmentShader: fragment,
    });
  }
  const skin = material(char, true), initial = [];
  // Разные калибры вперемешку. На зольной кромке остаются отдельные мелкие обломки.
  const count = 200;
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + rnd()) / count) * 1.11, a = i * 2.39996 + (rnd() - 0.5) * 0.25;
    const x = r * Math.cos(a), z = r * Math.sin(a) * DEPTH;
    const size = (0.061 + rnd() ** 1.45 * 0.125) * (1 - 0.52 * THREE.MathUtils.smoothstep(r, 0.78, 1.12));
    initial.push({ x, z, size, lift: rnd() * size * 0.15, birth: -100, seed: rnd() * 0xffffffff });
  }
  const base = new THREE.Mesh(groundGeometry(), material(bed, false));
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

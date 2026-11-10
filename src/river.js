import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { tiles, soften } from './surface.js';
import { groundPatch } from './terrain.js';
import { windUniforms } from './wind.js';

// Речка за задним забором (каталог ChatGPT «Мелкая речка», 2026-11-10; ориентир — Атца). Узкая, 2–3 м по воде,
// 20–40 см глубиной, течёт вдоль двора по x и петляет. На изгибе с внутренней стороны — пологая галечная отмель,
// с внешней вода подмывает берег: короткий крутой глинистый откос, сверху дернина. За двором русло изгибается от
// двора, поэтому отмель — со стороны двора, откос — с дальней. Вокруг русла — пойма: её выровняла вода, поэтому
// длинной волны рельефа там нет (calm для terrain.js), луг сходит к ней пологим спуском.
// Всё в метрах двора, улица — к +z, речка — к −z. Рельеф отдаёт dug(x, z), как улица в road.js.
const AXIS = { z: -33, bend: 2.5, period: 60, wander: 1.5 };   // ось: середина по z, размах и длина изгиба, шум
const WIDTH = [2, 3], DEPTH = [0.2, 0.4];                       // м: ширина по воде, глубина в русле
const LEVEL = { at: -0.9, slope: 0.002 };                       // вода: высота у x = 0 и уклон вниз по течению (+x)
// Берег над водой: высота и ширина подъёма — у отмели внутри изгиба (low, shoal) и у откоса снаружи (high, steep).
const BANK = { low: 0.4, high: 0.9, shoal: 5, steep: 0.25 };
const LIP = { top: 0.25, edge: 0.12 };                          // неровность берегов: доля высоты откоса, м уреза
const TUFT = 0.4;                                               // м: трава на берегу — её тоже видно в отражении
const PLAIN = 5;                                                // м: за столько пойма переходит в луг
const REACH = 140;                                              // м: русло в обе стороны от середины двора
const BAND = { half: 7, step: 0.1 };                            // полоса частой сетки земли вокруг русла

// Дно и берег — пока уличный грунт (road-base), до плиток ChatGPT (design/river/river-assets-prompt.md):
// глина дна, галька переката, глина откоса.
const BED_TILE = 1, ARC = 0.1;   // м: плитка 1 × 1 м; шаг, которым меряют путь поперёк берега
const [bedMap] = tiles(['assets/textures/road-base.jpg']);
const bed = soften(new THREE.MeshLambertMaterial({ map: bedMap, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
  { contrast: 0.9, saturation: 0.8, scales: [0.13, 0.5], low: [0.92, 0.92, 0.9], high: [1.02, 1.02, 1], cells: [4, 2] });
const WATER = flowingWater();

export function planRiver(seed) {
  const rnd = generator(seed + 89);
  const smooth = smoothNoise(rnd), noise = (x, k) => 2 * smooth(x, 13 * k) - 1;
  const s = THREE.MathUtils.smoothstep, phase = rnd() * 9;
  const k = (2 * Math.PI) / AXIS.period;
  // Ось и её производные по x: за серединой двора русло дальше всего от забора.
  const center = (x) => AXIS.z - AXIS.bend * Math.cos(k * x) + AXIS.wander * noise(x / 37 + phase, 1);
  const slope = (x) => (center(x + 0.05) - center(x - 0.05)) / 0.1;
  const curve = (x) => (center(x + 0.5) - 2 * center(x) + center(x - 0.5)) / 0.25;
  const level = (x) => LEVEL.at - LEVEL.slope * x;
  // Сечение у x: полуширина по воде, глубина и изгиб: 0 — прямо, ±1 — круто, знак — куда внутренняя сторона
  // (плюс — к +z). На перегибе между изгибами он проходит через 0, и берега меняются местами плавно.
  // Берега неровные: высота откоса гуляет на ±25 % через несколько метров, урез — на ладонь туда-сюда; у каждого
  // берега своё (top, edge: [к −z, к +z]).
  const section = (x) => ({
    w: (WIDTH[0] + (WIDTH[1] - WIDTH[0]) * (0.5 + 0.5 * noise(x / 23, 2))) / 2,
    d: DEPTH[0] + (DEPTH[1] - DEPTH[0]) * (0.5 + 0.5 * noise(x / 17, 3)),
    bend: THREE.MathUtils.clamp((30 * curve(x)) / (1 + slope(x) ** 2) ** 1.5, -1, 1),
    top: [1 + LIP.top * noise(x / 5, 4), 1 + LIP.top * noise(x / 5, 5)],
    edge: [LIP.edge * noise(x / 2.5, 6), LIP.edge * noise(x / 2.5, 7)],
  });
  // Поперёк русла: сколько метров от оси, плюс — к +z.
  const across = (x, z) => (z - center(x)) / Math.sqrt(1 + slope(x) ** 2);
  // Берег той стороны русла, где лежит u. Самое глубокое место (deep) сдвинуто к внешней стороне изгиба.
  // out — насколько сторона внешняя: 0 — отмель, 1 — откос, 0,5 — прямой плёс. shore — урез (от оси, со знаком),
  // top — на сколько берег поднимается над водой, run — за сколько метров от уреза: от пологой отмели до крутого откоса.
  const side = (u, { w, bend, top, edge }) => {
    const deep = -0.35 * bend * w, sign = u < deep ? -1 : 1, k = (sign + 1) / 2, out = 0.5 - 0.5 * sign * bend;
    return {
      deep, sign, shore: sign * (w + edge[k]),
      top: (BANK.low + (BANK.high - BANK.low) * out) * top[k],
      run: BANK.shoal * (BANK.steep / BANK.shoal) ** out,
    };
  };
  // Высота над водой в сечении sec на расстоянии u от оси. Над водой берег поднимается от уреза и выполаживается
  // к пойме. Под водой дно идёт от ровного самого глубокого места к урезу (кубика Эрмита) и у уреза уходит под воду
  // с тем же наклоном, что берег над ней: отмель полого, откос круче — но не круче, чем позволяет глубина,
  // иначе у дна вырос бы горб.
  const rise = (u, sec) => {
    const { deep, sign, shore, top, run } = side(u, sec), beyond = sign * (u - shore);
    if (beyond > 0) return top * (1 - Math.max(0, 1 - beyond / run) ** 2);
    const t = (u - deep) / (shore - deep), lean = Math.min(((2 * top) / run) * Math.abs(shore - deep), 3 * sec.d);
    return -sec.d * (2 * t ** 3 - 3 * t ** 2 + 1) + lean * (t ** 3 - t ** 2);
  };
  // Сколько метров от верха берега в сторону луга (до него — минус).
  const reach = (u, sec) => {
    const { sign, shore, run } = side(u, sec);
    return sign * (u - shore) - run;
  };
  // Дальше FAR от середины изгибов пойма точно кончилась: считать сечение незачем.
  const FAR = AXIS.bend + AXIS.wander + WIDTH[1] / 2 + LIP.edge + BANK.shoal + PLAIN;
  const plain = (x, z) => {
    if (Math.abs(z - AXIS.z) > FAR) return 0;
    return 1 - s(reach(across(x, z), section(x)), 0, PLAIN);
  };
  const dug = (x, z) => {
    const p = plain(x, z);
    return p && -p * (level(x) + rise(across(x, z), section(x)));
  };
  // Над водой у самого уреза и на крутом откосе травы нет — голая глина; ниже уреза — дно.
  const bare = (x, z) => {
    if (!plain(x, z)) return 0;
    const sec = section(x), u = across(x, z), e = rise(u, sec);
    const steep = Math.abs(rise(u + 0.05, sec) - rise(u - 0.05, sec)) / 0.1;
    return Math.max(1 - s(e, 0.06, 0.2), s(steep, 0.7, 1.4));
  };
  const grass = (x, z) => 1 - bare(x, z);
  // Мокро ниже уреза и на пару пальцев выше: глина там темнее.
  const wet = (x, z) => 1 - s(rise(across(x, z), section(x)), 0, 0.05);
  const rows = [[AXIS.z - AXIS.bend - AXIS.wander - BAND.half, AXIS.z + AXIS.bend + AXIS.wander + BAND.half, BAND.step]];
  return { center, slope, level, section, across, side, rise, dug, calm: plain, grass, bare, wet, rows };
}

// Строить после makeMeadow: дно и берег лежат на куске той же сетки земли.
export function buildRiver(river) {
  const group = new THREE.Group();
  // Дно и голый берег: покрытие на сетке земли, к траве тает.
  const patch = groundPatch((x, z) => river.bare(x, z) > 0);
  const pos = patch.attributes.position;
  const uv = [], color = [];
  // Плитка вдоль — по x, поперёк — по пути через профиль от оси: на крутом откосе она не тянется, а ложится «в лоб».
  const arc = (x, z) => {
    const sec = river.section(x), u = river.across(x, z), n = Math.ceil(Math.abs(u) / ARC), du = u / n;
    let path = 0, h = river.rise(0, sec);
    for (let k = 1; k <= n; k++) {
      const e = river.rise(k * du, sec);
      path += Math.hypot(du, e - h);
      h = e;
    }
    return Math.sign(u) * path;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    uv.push(x / BED_TILE, -arc(x, z) / BED_TILE);
    const tone = 1 - 0.4 * river.wet(x, z);
    color.push(tone, tone, tone, river.bare(x, z));
  }
  patch.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  patch.setAttribute('color', new THREE.Float32BufferAttribute(color, 4));
  const floor = new THREE.Mesh(patch, bed);
  floor.receiveShadow = true;
  floor.renderOrder = 1;
  group.add(floor, water(river));
  return group;
}

// Вода — лента по руслу на уровне воды, шире русла: у берега её закрывает земля, урез — где они пересекаются.
// В вершинах: depth — глубина до дна, flow — метры вдоль течения и поперёк, along — направление течения,
// bank — берега для отражения: сколько метров до каждого (к −n, к +n) и как высоко он поднимается над водой
// вместе с травой. Берег для этого — стенка посередине его подъёма.
const STEP = 0.5, ACROSS = 10, MARGIN = 0.8;
function water(river) {
  const pos = [], depth = [], flow = [], along = [], bank = [], index = [];
  let path = 0;
  for (let x = -REACH, i = 0; x <= REACH; x += STEP, i++) {
    const sec = river.section(x), cz = river.center(x), y = river.level(x);
    const t = new THREE.Vector2(1, river.slope(x)).normalize(), n = new THREE.Vector2(-t.y, t.x);
    const [near, far] = [-1, 1].map((sign) => river.side(sign * sec.w, sec));
    if (i) path += STEP * Math.hypot(1, river.slope(x));
    for (let j = 0; j <= ACROSS; j++) {
      const v = (j / ACROSS - 0.5) * 2 * (sec.w + MARGIN);
      pos.push(x + n.x * v, y, cz + n.y * v);
      depth.push(-river.rise(v, sec));
      flow.push(path, v);
      along.push(t.x, t.y);
      bank.push(-near.shore + near.run / 2 + v, far.shore + far.run / 2 - v, near.top + TUFT, far.top + TUFT);
      if (i && j) {
        const c = i * (ACROSS + 1) + j, p = c - (ACROSS + 1);
        index.push(p - 1, p, c - 1, p, c, c - 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  geometry.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
  geometry.setAttribute('along', new THREE.Float32BufferAttribute(along, 2));
  geometry.setAttribute('bank', new THREE.Float32BufferAttribute(bank, 4));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, WATER);
  mesh.renderOrder = 2;
  return mesh;
}

// Вода: у кромки тонкий слой, сквозь него видно дно и камни; к середине русла цвет плотнее и дно приглушается.
// По воде бежит мелкая рябь вдоль течения — шум, сдвигаемый со временем по оси русла; рябь наклоняет нормаль.
// Отражение — по Шлику, как в лужах (road.js): сверху почти не отражает, вскользь — почти зеркало. Отражается небо,
// а у берегов — сами берега: луч, отражённый водой, уходит поперёк русла и упирается в берег, если не успел
// подняться выше него (с травой): в отражении глина и трава, бурые с зеленью. Цвета — в линейном свете, как в шейдере.
const DEEP = 0.35, CLEAR = 0.12, MURK = 0.8, FLOW = 0.35;
const SKY = 'vec3(0.78, 1.0, 1.4)', SHORE = 'vec3(0.1, 0.1, 0.055)';
function flowingWater() {
  const material = new THREE.MeshLambertMaterial({ color: 0x3e4d44, transparent: true, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float depth;
        attribute vec2 flow, along;
        attribute vec4 bank;
        varying float vDepth;
        varying vec2 vFlow, vAlong;
        varying vec4 vBank;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDepth = depth; vFlow = flow; vAlong = along; vBank = bank;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float windTime;
        varying float vDepth;
        varying vec2 vFlow, vAlong;
        varying vec4 vBank;
        float rippleHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rippleNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rippleHash(i), rippleHash(i + vec2(1, 0)), f.x), mix(rippleHash(i + vec2(0, 1)), rippleHash(i + vec2(1, 1)), f.x), f.y);
        }
        // Рябь: два слоя штрихов, вытянутых поперёк течения и бегущих по нему; над отмелью гуще.
        float ripple(vec2 p) {
          float t = windTime * ${FLOW.toFixed(2)};
          return rippleNoise(p * vec2(2.0, 5.0) - vec2(3.0 * t, 0.0)) + 0.5 * rippleNoise(p * vec2(4.5, 11.0) - vec2(5.0 * t, 0.3 * t));
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float e = 0.03, r0 = ripple(vFlow);
        vec2 slope = vec2(ripple(vFlow + vec2(e, 0.0)) - r0, ripple(vFlow + vec2(0.0, e)) - r0) / e;
        slope *= 0.012 * (1.0 + 1.5 * (1.0 - smoothstep(0.0, ${DEEP.toFixed(2)}, vDepth)));
        vec3 tilt = vec3(vAlong.x, 0.0, vAlong.y) * slope.x + vec3(-vAlong.y, 0.0, vAlong.x) * slope.y;
        normal = normalize(normal - mat3(viewMatrix) * tilt);`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float deep = smoothstep(0.0, ${DEEP.toFixed(2)}, vDepth);
        float mirror = 0.02 + 0.98 * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 5.0);
        gl_FragColor.a = mix(${CLEAR.toFixed(2)}, ${MURK.toFixed(2)}, deep);
        vec3 ray = (vec4(reflect(-normalize(vViewPosition), normal), 0.0) * viewMatrix).xyz;
        float horiz = length(ray.xz) + 1e-4, aside = dot(ray.xz, vec2(-vAlong.y, vAlong.x)) / horiz;
        vec2 wall = aside > 0.0 ? vBank.yw : vBank.xz;
        float climb = ray.y / horiz * max(wall.x, 0.0) / max(abs(aside), 0.05);
        vec3 seen = mix(${SHORE}, ${SKY}, smoothstep(0.7, 1.3, climb / wall.y));
        gl_FragColor = mix(gl_FragColor, vec4(seen, 1.0), mirror);
        gl_FragColor.a *= smoothstep(0.0, 0.02, vDepth);`);
  };
  material.customProgramCacheKey = () => 'river';
  return material;
}

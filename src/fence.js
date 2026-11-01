import * as THREE from 'three';
import { tiles } from './surface.js';
import { generator } from './random.js';

// Забор по периметру участка W × D метров с центром в начале координат: штакетник со всех сторон,
// к дороге (z = +D/2) — с калиткой. Доски крашеные, ровные, верх углом, между ними сквозные щели: сквозь них
// чуть видно улицу, а солнце кладёт полосы на траву. Столбы — бруски, крашеные так же.
// Вид забора Никита подобрал на глаз клавишами (2026-11-01) и пока живёт с ним: высота 1,8 м, щели 3 см,
// доски и столбы по 10 см, забор ветхий, краска как тёмное бревно, тень лёгкая.
export const YARD = { w: 60, d: 40 };
const LOOK = { height: 1.8, gap: 0.03, boardWidth: 0.1, postWidth: 0.1, age: 1.8 }; // age — во сколько раз сильнее кривизна
const COLOR = 'vec3(0.12, 0.11, 0.1)'; // линейный цвет краски: тёмное старое бревно
const SHADOW = '0.55'; // доля солнца, которую тень на заборе отнимает

// Картинки от ChatGPT: по 10 досок и прожилин; доски бесшовные по обеим осям, прожилины — по длине.
// Каждая деталь берёт одну из них наугад; столбы красят теми же картинками, что и доски.
const KINDS = 10;
// Метров на одно повторение картинки вдоль детали: по ширине картинка ложится на доску целиком,
// а вверх растянута вдвое против своих пропорций, чтобы сучки не повторялись через каждые 30 см.
const BOARD_SPAN = 0.7, RAIL_SPAN = 1.6;
const BOARD = 0.1; // м: такую ширину доски изображает картинка — в этом масштабе она ложится на столбы

// Краску кладём по яркости синей картинки: доска той же яркости, что средняя краска, получает
// ровно цвет COLOR, а сучки, прожилки и потёртости остаются — темнее или светлее его.
// Густота тени SHADOW — сколько солнца отнимает тень на заборе: и падающая от досок и деревьев,
// и на стороне, отвёрнутой от солнца. На освещённых местах ничего не меняется.
// Средний цвет краски на картинках досок (линейный).
const PAINT = 'vec3(0.067, 0.24, 0.63)';
function painted(map) {
  const material = new THREE.MeshLambertMaterial({ map });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        float fenceLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = ${COLOR} * fenceLuma / dot(${PAINT}, vec3(0.299, 0.587, 0.114));`)
      // Солнце — первый направленный свет. Без тени доска получала бы его под тем же углом с любой стороны:
      // тонкая доска с двух сторон одинаково повёрнута к солнцу. Тень возвращает часть этого света.
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #if NUM_DIR_LIGHTS > 0
          vec3 fenceSun = directionalLights[0].color * cloudLight() * abs(dot(normal, directionalLights[0].direction)) * BRDF_Lambert(diffuseColor.rgb);
          reflectedLight.directDiffuse = mix(fenceSun, reflectedLight.directDiffuse, ${SHADOW});
        #endif`);
  };
  material.customProgramCacheKey = () => 'fence';
  return material;
}
// Столбы красят теми же картинками, что и доски.
const maps = (name) => tiles(Array.from({ length: KINDS }, (_, i) => `assets/textures/fence-${name}-${i + 1}.jpg`)).map(painted);
const boards = maps('board');
const materials = { board: boards, post: boards, rail: maps('rail') };

// Доска с верхом углом: пятиугольник шириной w и высотой h, толщиной t. Картинка лежит по ширине доски
// и повторяется вверх, начиная с места shift: соседние доски одной картинки не совпадают.
function board(w, h, t, shift) {
  const outline = [[-w / 2, 0], [w / 2, 0], [w / 2, h - w / 2], [0, h], [-w / 2, h - w / 2]];
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))),
    { depth: t, bevelEnabled: false }).translate(0, 0, -t / 2);
  const p = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / BOARD_SPAN + shift);
  return geometry;
}
// Брусок с основанием в нуле; картинка на гранях повторяется [вдоль, вверх] раз.
function block(sx, sy, sz, [along, up]) {
  const geometry = new THREE.BoxGeometry(sx, sy, sz).translate(0, sy / 2, 0);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * along, uv.getY(i) * up);
  return geometry;
}
// Столб — брусок со стороной w; картинка доски ложится на грань в том же масштабе, что на доску.
const post = (w, h) => block(w, h, w, [w / BOARD, h / BOARD_SPAN]);

// Детали одной картинки сливаем в одну геометрию: тысяча досок — один вызов отрисовки.
function merge(parts) {
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

// Сторона забора — отрезок от a до b по земле; деталь ставим по координате s вдоль него,
// со сдвигом off наружу участка и наклоном tilt вдоль стороны.
function side(a, b) {
  const dir = new THREE.Vector2(b.x - a.x, b.z - a.z), length = dir.length();
  dir.normalize();
  const yaw = Math.atan2(-dir.y, dir.x);
  // tilt — наклон вдоль стороны, lean — поперёк неё, наружу (+) или во двор (−).
  const place = (s, off, y, tilt = 0, lean = 0) => new THREE.Matrix4().compose(
    new THREE.Vector3(a.x + dir.x * s - dir.y * off, y, a.z + dir.y * s + dir.x * off),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, tilt, 'YXZ')), new THREE.Vector3(1, 1, 1));
  return { length, place };
}

// Штакетник: столбы через 2,5 м, на них в каждом пролёте две прожилины, к ним прибиты доски ровным рядом.
// Прожилины прибиты к столбам снаружи, доски — к прожилинам: чем толще столб, тем дальше они от его оси.
// В каждом пролёте доски делят его поровну, и каждый столб приходится на середину щели: доски заходят
// на него с обеих сторон одинаково. Столб срезан вровень с плечами досок — там, где начинается их угол.
//
// Забор стоит не первый год. Столбы просели в землю или их выперло морозом и они накренились —
// прожилины легли между ними под уклон, а доски на прожилинах повторяют этот уклон и крен. Сами доски
// прибиты не по линейке: чуть вкось, чуть выше-ниже, чуть разной длины. Угловые столбы держат две стороны
// и стоят ровно. Всё это — доли градуса и сантиметры, умноженные на возраст age: при нуле забор как новый.
const LIFT = 0.05, GATE_LIFT = 0.12; // м: доски не достают до земли, у калитки — выше
const DEG = Math.PI / 180;
function picket({ length, place }, { height, gap, boardWidth, postWidth, age }, rnd, put, gate) {
  const wobble = (size) => (rnd() + rnd() - 1) * size * age; // чаще около нуля, изредка до ±size
  const posts = [];
  for (let s = 0; s <= length + 0.01; s += 2.5) if (gate === undefined || Math.abs(s - gate) >= 0.8) posts.push(s);
  if (gate !== undefined) posts.push(gate - 0.6, gate + 0.6);
  posts.sort((a, b) => a - b);
  const corner = (s) => s < 0.01 || s > length - 0.01;
  const sag = posts.map((s) => (corner(s) ? 0 : wobble(0.04)));       // м: просел (−) или выперло (+)
  const lean = posts.map((s) => (corner(s) ? 0 : wobble(2.5 * DEG)));  // крен поперёк забора
  const r = postWidth / 2, rails = r + 0.026, front = rails + 0.037;
  const shoulder = LIFT + height - boardWidth / 2;
  posts.forEach((s, i) => {
    const atGate = gate !== undefined && Math.abs(s - gate) < 0.7;
    const geometry = atGate ? post(postWidth * 1.2, shoulder + 0.25) : post(postWidth, shoulder);
    put('post', geometry.applyMatrix4(place(s, 0, sag[i], wobble(1.5 * DEG), lean[i])));
  });
  for (let i = 1; i < posts.length; i++) {
    const a = posts[i - 1], span = posts[i] - a, inGate = gate !== undefined && a < gate && gate < posts[i];
    const slope = (sag[i] - sag[i - 1]) / span, tilt = Math.atan(slope);
    const height0 = (s) => sag[i - 1] + slope * (s - a); // насколько сдвинулся пролёт у места s
    const lean0 = (s) => lean[i - 1] + (lean[i] - lean[i - 1]) * (s - a) / span;
    // Прожилину крепят к столбу на высоте y — с креном столба она уходит наружу на y·крен.
    for (const y of [0.3, height - 0.45]) {
      const mid = a + span / 2, tip = lean0(mid);
      put('rail', block(span, 0.08, 0.05, [span / RAIL_SPAN, 1]).applyMatrix4(place(mid, rails + y * tip, y + height0(mid), tilt, tip)));
    }
    const n = Math.max(1, Math.round(span / (boardWidth + gap))), step = span / n;
    for (let k = 0; k < n; k++) {
      const s = a + (k + 0.5) * step + wobble(0.006);
      const h = (inGate ? height - 0.17 : height) + wobble(0.012);
      const y = (inGate ? GATE_LIFT : LIFT) + height0(s) + wobble(0.012);
      put('board', board(boardWidth, h, 0.022, rnd())
        .applyMatrix4(place(s, front, y, tilt + wobble(1.2 * DEG), lean0(s) + wobble(0.6 * DEG))));
    }
  }
  if (gate === undefined) return;
  // Доски калитки держит укосина из угла в угол.
  const across = 0.9, up = height - 0.8;
  put('rail', block(0.05, Math.hypot(across, up), 0.08, [1, 1]).applyMatrix4(place(gate - across / 2, rails, 0.34, -Math.atan2(across, up))));
}

export function makeFence() {
  const root = new THREE.Group();
  const rnd = generator(7);
  const parts = { board: [], post: [], rail: [] };
  for (const name in parts) parts[name] = Array.from({ length: KINDS }, () => []);
  const put = (name, geometry) => parts[name][Math.floor(rnd() * KINDS)].push(geometry);
  const x = YARD.w / 2, z = YARD.d / 2;
  // Обходим участок по часовой стрелке при взгляде сверху: тогда «наружу» у каждой стороны смотрит от двора.
  picket(side({ x: -x, z }, { x, z }), LOOK, rnd, put, x + 8);
  picket(side({ x, z }, { x, z: -z }), LOOK, rnd, put);
  picket(side({ x, z: -z }, { x: -x, z: -z }), LOOK, rnd, put);
  picket(side({ x: -x, z: -z }, { x: -x, z }), LOOK, rnd, put);
  for (const name in parts) {
    parts[name].forEach((list, i) => {
      if (!list.length) return;
      const mesh = new THREE.Mesh(merge(list), materials[name][i]);
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    });
  }
  return root;
}

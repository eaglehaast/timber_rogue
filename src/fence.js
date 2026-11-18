import * as THREE from 'three';
import { tiles, merge } from './surface.js';
import { generator } from './random.js';
import { height } from './terrain.js';

// Забор по периметру участка W × D метров с центром в начале координат: штакетник со всех сторон,
// к дороге (z = +D/2) — с калиткой и воротами. Доски крашеные, ровные, верх углом, между ними сквозные щели: сквозь них
// чуть видно улицу, а солнце кладёт полосы на траву. Столбы — бруски, крашеные так же.
// Вид забора Никита подобрал на глаз клавишами (2026-11-01) и пока живёт с ним: высота 1,8 м, щели 3 см,
// доски и столбы по 10 см, забор ветхий, краска как тёмное бревно, тень лёгкая.
export const YARD = { w: 60, d: 40 };
const LOOK = { height: 1.8, gap: 0.03, boardWidth: 0.1, postWidth: 0.1, age: 1.8 }; // age — во сколько раз сильнее кривизна
const COLOR = 'vec3(0.12, 0.11, 0.1)'; // линейный цвет краски: тёмное старое бревно
const SHADOW = '0.55'; // доля солнца, которую тень на заборе отнимает

// Картинки от ChatGPT: по 10 досок и прожилин; доски бесшовные по обеим осям, прожилины — по длине.
// Каждая деталь берёт одну из них наугад; столбы красят теми же картинками, что и доски.
export const KINDS = 10;
// Метров на одно повторение картинки вдоль детали: по ширине картинка ложится на доску целиком,
// а вверх растянута вдвое против своих пропорций, чтобы сучки не повторялись через каждые 30 см.
export const BOARD_SPAN = 0.7;
const RAIL_SPAN = 1.6;
export const BOARD = 0.1; // м: такую ширину доски изображает картинка — в этом масштабе она ложится на столбы

// Краску кладём по яркости синей картинки: доска той же яркости, что средняя краска, получает
// ровно цвет COLOR, а сучки, прожилки и потёртости остаются — темнее или светлее его.
// Густота тени SHADOW — сколько солнца отнимает тень на заборе: и падающая от досок и деревьев,
// и на стороне, отвёрнутой от солнца. На освещённых местах ничего не меняется.
// Средний цвет краски на картинках досок (линейный).
export const PAINT = 'vec3(0.067, 0.24, 0.63)';
// Сталь ворот (стойки-трубы, петли, засовы) красить не нужно — у неё своя картинка, а тень та же, что у досок.
function material(map, paint = true) {
  const material = new THREE.MeshLambertMaterial({ map });
  material.onBeforeCompile = (shader) => {
    if (paint) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float fenceLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = ${COLOR} * fenceLuma / dot(${PAINT}, vec3(0.299, 0.587, 0.114));`);
    // Солнце — первый направленный свет. Без тени доска получала бы его под тем же углом с любой стороны:
    // тонкая доска с двух сторон одинаково повёрнута к солнцу. Тень возвращает часть этого света.
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #if NUM_DIR_LIGHTS > 0
          vec3 fenceSun = directionalLights[0].color * cloudLight() * abs(dot(normal, directionalLights[0].direction)) * BRDF_Lambert(diffuseColor.rgb);
          reflectedLight.directDiffuse = mix(fenceSun, reflectedLight.directDiffuse, ${SHADOW});
        #endif`);
  };
  material.customProgramCacheKey = () => (paint ? 'fence' : 'fence-steel');
  return material;
}
// Столбы красят теми же картинками, что и доски. Сталь от ChatGPT (набор ворот M12): воронёная —
// трубы и петли, потёртая — то, за что берутся руками: засов, штырь, ручка.
const maps = (name) => tiles(Array.from({ length: KINDS }, (_, i) => `assets/textures/fence-${name}-${i + 1}.jpg`)).map((m) => material(m));
const boards = maps('board');
const BLACK = 0, WORN = 1;
const materials = { board: boards, post: boards, rail: maps('rail'),
  steel: tiles(['assets/textures/gate-steel-black.jpg', 'assets/textures/gate-steel-worn.jpg']).map((m) => material(m, false)) };

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
// Стальные детали: картинка стали повторяется через STEEL метров. Пруток или труба радиуса r — вверх от нуля
// на длину h; полоса — брусок sx × sy × sz.
const STEEL = 0.25;
function rod(r, h, sides = 10) {
  const geometry = new THREE.CylinderGeometry(r, r, h, sides).translate(0, h / 2, 0);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * r / STEEL, uv.getY(i) * h / STEEL);
  return geometry;
}
const bar = (r, length) => rod(r, length).rotateZ(-Math.PI / 2); // лёжа вдоль стороны, от нуля
const strip = (sx, sy, sz) => block(sx, sy, sz, [sx / STEEL, sy / STEEL]);

// Сторона забора — отрезок от a до b по земле; деталь ставим по координате s вдоль него,
// со сдвигом off наружу участка и наклоном tilt вдоль стороны. rest(x, z) — ниже какой высоты верх забора
// не опускается: там, где земля ниже, столбы длиннее.
function side(a, b, rest = () => -Infinity) {
  const dir = new THREE.Vector2(b.x - a.x, b.z - a.z), length = dir.length();
  dir.normalize();
  const yaw = Math.atan2(-dir.y, dir.x);
  // tilt — наклон вдоль стороны, lean — поперёк неё, наружу (+) или во двор (−).
  const place = (s, off, y, tilt = 0, lean = 0) => new THREE.Matrix4().compose(
    new THREE.Vector3(a.x + dir.x * s - dir.y * off, y, a.z + dir.y * s + dir.x * off),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, tilt, 'YXZ')), new THREE.Vector3(1, 1, 1));
  // Земля под точкой s стороны: столбы стоят на ней, а пролёты тянутся от столба к столбу.
  const at = (s) => [a.x + dir.x * s, a.z + dir.y * s];
  const floor = (s) => height(...at(s));
  // По этой высоте идёт верх забора: земля, но не ниже rest.
  const level = (s) => Math.max(floor(s), rest(...at(s)));
  return { length, place, floor, level };
}

// Штакетник: столбы через 2,5 м (STEP), на них в каждом пролёте две прожилины, к ним прибиты доски ровным рядом.
// Прожилины прибиты к столбам снаружи, доски — к прожилинам: чем толще столб, тем дальше они от его оси.
// В каждом пролёте доски делят его поровну, и каждый столб приходится на середину щели: доски заходят
// на него с обеих сторон одинаково. Столб срезан вровень с плечами досок — там, где начинается их угол.
//
// Забор стоит не первый год. Столбы просели в землю или их выперло морозом и они накренились —
// прожилины легли между ними под уклон, доски на прожилинах повторяют крен, а верхом — уклон. Сами доски
// прибиты не по линейке: чуть вкось, чуть выше-ниже, чуть разной длины. Угловые столбы держат две стороны
// и стоят ровно. Всё это — доли градуса и сантиметры, умноженные на возраст age: при нуле забор как новый.
//
// Проёмы openings — { at, width, leaves, pipe } вдоль стороны: калитка (одна створка) и ворота (две). Устроены
// по каталогу ворот от ChatGPT (B04, M12): по краям проёма — круглые стальные стойки-трубы радиуса pipe с заглушкой,
// выше забора. Створка — рамка из прожилин и боковин с раскосом от нижней петли к верхнему углу у притвора, доски
// прибиты к ней снаружи вровень с краями, створка ниже забора и приподнята над землёй. От трубы её отделяет зазор,
// створки ворот сходятся посередине без столба. Каждую створку держат две петли: полоса на прожилине, на её конце
// втулка на штыре уха, приваренного к трубе. Всё железо со двора (створки открываются во двор), с улицы только ручка калитки.
const LIFT = 0.05, GATE_LIFT = 0.12; // м: доски не достают до земли, у створок — выше
const CLEAR = 0.025, SEAM = 0.01; // м: зазор от створки до трубы и половина щели между створками ворот
const DEG = Math.PI / 180;
const STEP = 2.5; // м: шаг столбов
function picket({ length, place, floor, level }, { height, gap, boardWidth, postWidth, age }, rnd, put, openings = []) {
  const wobble = (size) => (rnd() + rnd() - 1) * size * age; // чаще около нуля, изредка до ±size
  const posts = [], seams = [], pipes = new Map(), key = (s) => Math.round(s * 100);
  const count = Math.ceil(length / STEP - 0.01); // столбы поровну, не реже STEP, и на обоих концах
  for (let i = 0; i <= count; i++) {
    const s = (length * i) / count;
    if (!openings.some((o) => Math.abs(s - o.at) < o.width / 2 + 0.2)) posts.push(s);
  }
  for (const o of openings) {
    for (const s of [o.at - o.width / 2, o.at + o.width / 2]) {
      if (!posts.some((p) => Math.abs(p - s) < 0.01)) posts.push(s);
      pipes.set(key(s), Math.max(pipes.get(key(s)) ?? 0, o.pipe));
    }
    if (o.leaves > 1) seams.push(o.at), posts.push(o.at);
  }
  posts.sort((a, b) => a - b);
  const corner = (s) => s < 0.01 || s > length - 0.01;
  const fixed = (s) => corner(s) || seams.includes(s);
  const sag = posts.map((s) => (fixed(s) ? 0 : wobble(0.04)) + level(s)); // м: откуда у столба отсчитан верх; просел (−) или выперло (+)
  const deeper = posts.map((s) => level(s) - floor(s)); // м: на сколько столб длиннее обычного — уходит ниже, до земли
  const lean = posts.map((s) => (fixed(s) ? 0 : wobble(2.5 * DEG)));  // крен поперёк забора
  const r = postWidth / 2, rails = r + 0.026, front = rails + 0.037, back = rails - 0.025; // back — дворовая грань прожилин
  const shoulder = LIFT + height - boardWidth / 2;
  posts.forEach((s, i) => {
    if (seams.includes(s)) return;
    const pipe = pipes.get(key(s)), at = place(s, 0, sag[i] - deeper[i], wobble(1.5 * DEG), lean[i]);
    if (!pipe) return put('post', post(postWidth, shoulder + deeper[i]).applyMatrix4(at));
    const top = shoulder + 0.25;
    put('steel', rod(pipe, top, 16).applyMatrix4(at), BLACK);
    put('steel', rod(pipe + 0.004, 0.006, 16).translate(0, top, 0).applyMatrix4(at), BLACK); // заглушка
  });
  const RAILS = [0.3, height - 0.45], [low, high] = RAILS;
  // Брусок из прожилины стоймя: ширина w, длина вверх, волокна вдоль длины.
  const upright = (length, w) => block(length, w, 0.05, [length / RAIL_SPAN, 1]).rotateZ(Math.PI / 2).translate(w / 2, length / 2, 0);
  for (let i = 1; i < posts.length; i++) {
    const a = posts[i - 1], b = posts[i], span = b - a, mid = a + span / 2;
    const leaf = openings.find((o) => Math.abs(mid - o.at) < o.width / 2);
    const slope = (sag[i] - sag[i - 1]) / span, tilt = Math.atan(slope);
    const height0 = (s) => sag[i - 1] + slope * (s - a); // насколько сдвинулся пролёт у места s
    const lean0 = (s) => lean[i - 1] + (lean[i] - lean[i - 1]) * (s - a) / span;
    // Деталь пролёта ставим в месте s на высоте y: с креном столбов она уходит наружу на y·крен.
    const fix = (name, geometry, s, off, y, kind) =>
      put(name, geometry.applyMatrix4(place(s, off + y * lean0(s), y + height0(s), tilt, lean0(s))), kind);
    // Створка занимает проём за вычетом зазоров у труб и щели посередине ворот.
    const edge = (s) => (seams.includes(s) ? SEAM : pipes.get(key(s)) + CLEAR);
    const lo = leaf ? a + edge(a) : a, hi = leaf ? b - edge(b) : b, width = hi - lo;
    for (const y of RAILS) fix('rail', block(width, 0.08, 0.05, [width / RAIL_SPAN, 1]), (lo + hi) / 2, rails, y);
    // В пролёте забора доски делят его поровну, на створке крайние доски — вровень с её краями.
    const n = leaf ? Math.round((width + gap) / (boardWidth + gap)) : Math.max(1, Math.round(span / (boardWidth + gap)));
    for (let k = 0; k < n; k++) {
      const s = (leaf ? lo + boardWidth / 2 + k * (width - boardWidth) / (n - 1) : a + (k + 0.5) * span / n) + wobble(0.006);
      // Доска прибита к прожилинам отвесно: верх идёт по их уклону, низ — над самой землёй (под горку доски длиннее).
      // Створка висит жёсткой рамкой: её доски одной длины и наклонены вместе с ней.
      const ground = leaf ? height0(s) : floor(s);
      const h = (leaf ? height - 0.17 : height + height0(s) - ground) + wobble(0.012);
      const y = (leaf ? GATE_LIFT : LIFT) + ground + wobble(0.012);
      put('board', board(boardWidth, h, 0.022, rnd())
        .applyMatrix4(place(s, front, y, (leaf ? tilt : 0) + wobble(1.2 * DEG), lean0(s) + wobble(0.6 * DEG))));
    }
    if (!leaf) continue;
    // hand — куда от петель к притвору: у правой створки ворот петли справа.
    const hand = mid > leaf.at + 0.01 ? -1 : 1, hinge = hand > 0 ? lo : hi, latch = hand > 0 ? hi : lo;
    const pivot = hand > 0 ? a : b, stop = hand > 0 ? b : a; // труба с петлями и труба у притвора
    // Боковины по краям, раскос — от нижней прожилины у петель к верхней у притвора.
    for (const s of [lo + 0.035, hi - 0.035]) fix('rail', upright(high + 0.08 - low, 0.07), s, rails, low);
    const across = Math.abs(latch - hinge) - 0.14, up = high - low - 0.08;
    fix('rail', upright(Math.hypot(across, up), 0.08).rotateZ(-hand * Math.atan2(across, up)), hinge + hand * 0.07, rails, low + 0.08);
    // Петли: втулка у трубы на штыре уха, от неё по прожилине идёт полоса.
    const knuckle = pivot + hand * (pipes.get(key(pivot)) + 0.016), strap = Math.min(0.6, width / 2);
    for (const y of RAILS) {
      fix('steel', rod(0.016, 0.08), knuckle, back - 0.003, y, BLACK);
      fix('steel', strip(strap, 0.045, 0.006), knuckle + hand * strap / 2, back - 0.003, y + 0.018, BLACK);
      fix('steel', strip(Math.abs(knuckle - pivot), 0.03, 0.01), (knuckle + pivot) / 2, back - 0.003, y + 0.085, BLACK);
    }
    const staple = (s, y) => fix('steel', strip(0.03, 0.05, 0.02), s, back - 0.01, y + 0.015, BLACK);
    if (leaf.leaves > 1 && hand < 0) {
      // Ходовая створка ворот (дальняя от калитки): засов на верхней прожилине уходит через щель в скобу соседней.
      staple(lo + 0.06, high), staple(lo + 0.22, high);
      fix('steel', bar(0.009, 0.32), lo - 0.08, back - 0.012, high + 0.04, WORN);
      fix('steel', rod(0.008, 0.06).rotateX(-Math.PI / 2), lo + 0.14, back - 0.012, high + 0.04, WORN);
    } else if (leaf.leaves > 1) {
      // Неподвижная створка: скоба для засова и штырь в гильзу, вкопанную в землю.
      staple(hi - 0.04, high);
      const s = hi - 0.12, ground = floor(s) - height0(s) - 0.04;
      for (const y of RAILS) staple(s, y);
      fix('steel', rod(0.009, high + 0.14 - ground), s, back - 0.012, ground, WORN);
      fix('steel', rod(0.008, 0.07).rotateX(-Math.PI / 2), s, back - 0.012, high + 0.13, WORN);
      fix('steel', rod(0.022, 0.035), s, back - 0.012, ground + 0.01, BLACK);
    } else {
      // Калитка: с улицы ручка-скоба у притвора с упором для большого пальца, со двора на обороте досок
      // язычок ложится в скобу на соседней трубе.
      const face = front + 0.011, s = latch - hand * 0.1, y = 0.95, pipe = pipes.get(key(stop));
      fix('steel', rod(0.008, 0.16), s, face + 0.035, y, WORN);
      for (const t of [y + 0.01, y + 0.15]) fix('steel', rod(0.006, 0.035).rotateX(Math.PI / 2), s, face, t, WORN);
      fix('steel', strip(0.03, 0.01, 0.04), s, face + 0.02, y + 0.17, WORN);
      fix('steel', strip(0.24, 0.03, 0.008), latch - hand * 0.04, front - 0.015, y + 0.02, BLACK);
      fix('steel', strip(pipe + 0.04, 0.05, 0.03), stop - hand * (pipe + 0.04) / 2, front - 0.033, y, BLACK);
    }
  }
}

// Калитка и ворота — со стороны дороги, x вдоль неё (от середины двора). Ворота — две створки по 1,7 м
// (Никита, 2026-11-08: въезд предусматривают и без машины — трактор впустить), рядом с калиткой, на общем столбе.
// Стойки — трубы 92 мм у калитки и 130 мм у ворот (pipe — радиус, м).
export const WICKET = { at: 8, width: 1.2, leaves: 1, pipe: 0.046 };
export const GATES = { at: 8.6 + 1.7, width: 3.4, leaves: 2, pipe: 0.065 };

// Без open участок обнесён со всех сторон (так в игре). open(x) — докуда по z идут боковые стороны, если сзади
// забора нет: на стенде за двором речка, боковые заборы доходят до воды, а заднего нет (Никита, 2026-11-10: так
// бывает в деревнях, хоть и не по закону).
export function makeFence({ open } = {}) {
  const root = new THREE.Group();
  const rnd = generator(7);
  const parts = Object.fromEntries(Object.entries(materials).map(([name, list]) => [name, list.map(() => [])]));
  // Картинка детали — наугад, у стали — какая сказано.
  const put = (name, geometry, kind = Math.floor(rnd() * KINDS)) => parts[name][kind].push(geometry);
  const x = YARD.w / 2, z = YARD.d / 2;
  // Обходим участок по часовой стрелке при взгляде сверху: тогда «наружу» у каждой стороны смотрит от двора.
  picket(side({ x: -x, z }, { x, z }), LOOK, rnd, put, [WICKET, GATES].map((o) => ({ ...o, at: o.at + x })));
  // Без заднего забора боковые стороны за двором спускаются под горку к воде. Верх там держится на уровне
  // угла двора, а столбы и доски тянутся вниз до земли.
  const end = open ?? (() => -z), rest = open && ((px, pz) => (pz < -z ? height(px, -z) : -Infinity));
  picket(side({ x, z }, { x, z: end(x) }, rest), LOOK, rnd, put);
  if (!open) picket(side({ x, z: -z }, { x: -x, z: -z }), LOOK, rnd, put);
  picket(side({ x: -x, z: end(-x) }, { x: -x, z }, rest), LOOK, rnd, put);
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

import * as THREE from 'three';
import { tiles } from './surface.js';

// Окно избы снаружи внутрь: наличник, переплёт рамы со стеклом, тюль на фоне тёмной комнаты.
// Наличники — резные рамы окон, картинки на прозрачном фоне (house-nalichnik.webp, 5 узоров в ряд).
// Каждая картинка — 1,1 × 2,2 м, вид строго спереди. У всех пяти один контур и один проём, поэтому
// проём в срубе меряется по картинке: PANE — ширина и высота проёма в метрах.
// Рисованы белым: цвет даёт код, на одном доме все наличники одного узора и цвета.
// Мерки картинок — в house-nalichnik.json (tools/nalichnik.py): рама, проём и внешний силуэт каждой рамы в пикселях;
// по силуэту рама получает толщину THICK — торец доски, отступающий от лица к брёвнам.
const SIZE = [1.1, 2.2];
const THICK = 0.03;
const KIT = await (await fetch('assets/textures/house-nalichnik.json')).json();
const COUNT = KIT.outlines.length;
const [FX0, FX1, FY0, FY1] = KIT.frame, [OX0, OX1, OY0, OY1] = KIT.opening;
const m = (px, axis) => (px / KIT.px[axis]) * SIZE[axis];
export const PANE = [m(OX1 - OX0, 0), m(OY1 - OY0, 1)];
export const TRIM_ABOVE = m(OY0 - FY0, 1); // рама над проёмом (кокошник)

// Краски наличников: голубая, синяя, красная, светло-жёлтая и белая; PAINT_ODDS — как часто каждая выпадает.
// Голубая как на референсе — чаще всего; белая — редко: рамы окон и так белые (Никита, 2026-11-07).
export const PAINTS = [[0.3, 0.55, 0.92], [0.14, 0.28, 0.66], [0.6, 0.15, 0.11], [0.9, 0.76, 0.38], [0.92, 0.92, 0.88]];
export const PAINT_ODDS = [4, 2, 2, 2, 0.6];
export const PATTERNS = COUNT;
// Тюль — 5 картинок Никиты, наложенных на цвет тёмной комнаты (house-tulle.jpg в ряд), середина по ширине проёма.
export const TULLES = 5;

// Переплёт: брусья рамы, средник и перекладина форточек (доля высоты от низа), всё белое.
// Глубины — от плоскости наличника внутрь стены: переплёт, стекло на его середине, тюль за ним.
const SASH = { bar: 0.05, mullion: 0.035, transom: 0.68, front: 0.06, back: 0.11, paint: [0.92, 0.92, 0.88] };
const GLASS = 0.085, TULLE = 0.14;
// Обсада — доски по краям проёма; под них брёвна пропилены шире проёма на эту толщину.
export const LINING = 0.03;

const [map, tulleMap] = tiles(['assets/textures/house-nalichnik.webp', 'assets/textures/house-tulle.jpg']);
const trimMaterials = PAINTS.map((paint) => new THREE.MeshLambertMaterial({ map, color: new THREE.Color(...paint), alphaTest: 0.5 }));
const edgeMaterials = PAINTS.map((paint) => new THREE.MeshLambertMaterial({ map, color: new THREE.Color(...paint) }));
const liningMaterials = PAINTS.map((paint) => new THREE.MeshLambertMaterial({ color: new THREE.Color(...paint).multiplyScalar(0.8) }));
const sashMaterial = new THREE.MeshLambertMaterial({ color: new THREE.Color(...SASH.paint) });
const tulleMaterial = new THREE.MeshLambertMaterial({ map: tulleMap });
const glassMaterial = new THREE.MeshBasicMaterial({ color: 0xc4d6e8, transparent: true, opacity: 0.22, depthWrite: false });

// Набор граней одной сетки; face кладёт четырёхугольник лицом к normal (обход сам подбирается по нормали).
export class Faces {
  pos = []; normal = []; uv = []; index = [];
  face(corners, normal, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const [a, b, c] = corners.map((p) => new THREE.Vector3(...p));
    const flip = b.sub(a).cross(c.sub(a)).dot(new THREE.Vector3(...normal)) < 0;
    const start = this.pos.length / 3;
    corners.forEach((p, k) => { this.pos.push(...p); this.normal.push(...normal); this.uv.push(...uvs[k]); });
    this.index.push(...(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]).map((k) => start + k));
  }
  mesh(material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setIndex(this.index);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
}

// Окна дома. walls — как в house.js (along, at); base — высота, от которой считаются низ и верх проёмов;
// out — плоскость наличника от оси стены наружу (чуть впереди брёвен), проём картинки совпадает с проёмом окна.
export function buildWindows({ openings, windows: { pattern, paint, tulle } }, walls, { base, out }) {
  const trims = new Faces(), sash = new Faces(), glass = new Faces(), tulles = new Faces();
  // Пиксель картинки → место на окне (a вправо от середины проёма, y вверх от его низа) и в атласе.
  const place = (x, y) => [m(x - (OX0 + OX1) / 2, 0), m(OY1 - y, 1)];
  const texel = (x, y) => [(pattern + x / KIT.px[0]) / COUNT, 1 - y / KIT.px[1]];
  // Силуэт рамы: точки и нормали наружу; обход картинки (y вниз) мог идти в любую сторону — узнаём по площади.
  const flat = KIT.outlines[pattern], outline = [];
  for (let i = 0; i < flat.length; i += 2) outline.push([flat[i], flat[i + 1]]);
  const turn = Math.sign(outline.reduce((sum, [x, y], i) => { const [x2, y2] = outline[(i + 1) % outline.length]; return sum + x * y2 - x2 * y; }, 0));
  const [w, h] = PANE;
  const lining = new Faces(), edges = new Faces();
  for (const o of openings) {
    if (o.kind !== 'window') continue;
    const wall = walls[o.wall], side = Math.sign(wall.at);
    // Середина низа проёма на оси стены; наружу n, вправо s (для того, кто смотрит на стену снаружи), вверх.
    // Точка окна: a — вправо от середины, y — вверх от низа проёма, d — внутрь от плоскости наличника.
    const c = wall.along === 'x' ? [o.at, base + o.bottom, wall.at] : [wall.at, base + o.bottom, o.at];
    const n = wall.along === 'x' ? [0, 0, side] : [side, 0, 0];
    const s = wall.along === 'x' ? [side, 0, 0] : [0, 0, -side];
    const at = (a, y, d) => [0, 1, 2].map((k) => c[k] + n[k] * (out - d) + s[k] * a + (k === 1 ? y : 0));
    const rect = (faces, a0, a1, y0, y1, d, uvs) => faces.face([at(a0, y0, d), at(a1, y0, d), at(a1, y1, d), at(a0, y1, d)], n, uvs);
    const corner = (x, y) => [...place(x, y), ...texel(x, y)];
    const [a0, y0, u0, v0] = corner(FX0, FY1), [a1, y1, u1, v1] = corner(FX1, FY0);
    rect(trims, a0, a1, y0, y1, 0, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    // Торцы рамы по силуэту: от лица наличника внутрь на THICK. Краска — с пикселя чуть внутри силуэта
    // (на самом краю картинки — контур пером), растянутая по толщине.
    outline.forEach(([x, y], i) => {
      const [x2, y2] = outline[(i + 1) % outline.length];
      const len = Math.hypot(x2 - x, y2 - y), nx = (turn * (y2 - y)) / len, ny = (turn * -(x2 - x)) / len; // наружу, в пикселях (y вниз)
      const [pa, py] = place(x, y), [qa, qy] = place(x2, y2);
      const tp = texel(x - nx * 8, y - ny * 8), tq = texel(x2 - nx * 8, y2 - ny * 8);
      const normal = [0, 1, 2].map((k) => s[k] * nx - (k === 1 ? ny : 0));
      edges.face([at(pa, py, 0), at(qa, qy, 0), at(qa, qy, THICK), at(pa, py, THICK)], normal, [tp, tq, tq, tp]);
    });
    // Обсада — доски по краям проёма от лица наличника до тюля: закрывают щель между наличником и рамой.
    const inward = (dir) => dir.map((k) => -k);
    lining.face([at(-w / 2, 0, 0), at(-w / 2, h, 0), at(-w / 2, h, TULLE), at(-w / 2, 0, TULLE)], s);
    lining.face([at(w / 2, 0, 0), at(w / 2, h, 0), at(w / 2, h, TULLE), at(w / 2, 0, TULLE)], inward(s));
    lining.face([at(-w / 2, 0, 0), at(w / 2, 0, 0), at(w / 2, 0, TULLE), at(-w / 2, 0, TULLE)], [0, 1, 0]);
    lining.face([at(-w / 2, h, 0), at(w / 2, h, 0), at(w / 2, h, TULLE), at(-w / 2, h, TULLE)], [0, -1, 0]);
    rect(tulles, -w / 2, w / 2, 0, h, TULLE, [[tulle / TULLES, 0], [(tulle + 1) / TULLES, 0], [(tulle + 1) / TULLES, 1], [tulle / TULLES, 1]]);
    rect(glass, -w / 2, w / 2, 0, h, GLASS);
    // Брус переплёта — коробка от a0 до a1 и от y0 до y1; задняя грань не видна.
    const bar = (a0, a1, y0, y1) => {
      const [f, b] = [SASH.front, SASH.back];
      rect(sash, a0, a1, y0, y1, f);
      const up = [0, 1, 0], right = s, leftDir = s.map((k) => -k);
      sash.face([at(a0, y1, f), at(a1, y1, f), at(a1, y1, b), at(a0, y1, b)], up);
      sash.face([at(a0, y0, f), at(a1, y0, f), at(a1, y0, b), at(a0, y0, b)], [0, -1, 0]);
      sash.face([at(a1, y0, f), at(a1, y1, f), at(a1, y1, b), at(a1, y0, b)], right);
      sash.face([at(a0, y0, f), at(a0, y1, f), at(a0, y1, b), at(a0, y0, b)], leftDir);
    };
    const { bar: B, mullion: M, transom: T } = SASH;
    bar(-w / 2, w / 2, 0, B); bar(-w / 2, w / 2, h - B, h);
    bar(-w / 2, -w / 2 + B, B, h - B); bar(w / 2 - B, w / 2, B, h - B);
    bar(-M / 2, M / 2, B, h - B);
    bar(-w / 2 + B, w / 2 - B, T * h - M / 2, T * h + M / 2);
  }
  return new THREE.Group().add(trims.mesh(trimMaterials[paint]), edges.mesh(edgeMaterials[paint]), lining.mesh(liningMaterials[paint]),
    sash.mesh(sashMaterial), tulles.mesh(tulleMaterial), Object.assign(glass.mesh(glassMaterial), { castShadow: false }));
}

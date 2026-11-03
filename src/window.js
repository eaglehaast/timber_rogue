import * as THREE from 'three';
import { tiles } from './surface.js';

// Окно избы снаружи внутрь: наличник, переплёт рамы со стеклом, тюль на фоне тёмной комнаты.
// Наличники — резные рамы окон, картинки на прозрачном фоне (house-nalichnik.webp, 5 узоров в ряд).
// Каждая картинка — 1,1 × 2,2 м, вид строго спереди. У всех пяти один контур и один проём, поэтому
// проём в срубе меряется по картинке: PANE — ширина и высота проёма в метрах.
// Рисованы белым: цвет даёт код, на одном доме все наличники одного узора и цвета.
const COUNT = 5;
const SIZE = [1.1, 2.2];
const PX = [1024, 2048];
// В пикселях картинки 1024 × 2048 (от левого верхнего угла): сама рама и проём в ней.
const FRAME = { x: [11, 1013], y: [104, 1831] };
const OPENING = { x: [231, 792], y: [544, 1587] };
const m = (px, axis) => (px / PX[axis]) * SIZE[axis];
export const PANE = [m(OPENING.x[1] - OPENING.x[0], 0), m(OPENING.y[1] - OPENING.y[0], 1)];
export const TRIM_ABOVE = m(OPENING.y[0] - FRAME.y[0], 1); // рама над проёмом (кокошник)

// Краски наличников: голубая как на референсе — чаще всего; белая, синяя, красная, светло-жёлтая.
export const PAINTS = [
  [0.3, 0.55, 0.92], [0.3, 0.55, 0.92], [0.92, 0.92, 0.88], [0.14, 0.28, 0.66], [0.6, 0.15, 0.11], [0.9, 0.76, 0.38],
];
export const PATTERNS = COUNT;
// Тюль — 5 картинок Никиты, наложенных на цвет тёмной комнаты (house-tulle.jpg в ряд), середина по ширине проёма.
export const TULLES = 5;

// Переплёт: брусья рамы, средник и перекладина форточек (доля высоты от низа), всё белое.
// Глубины — от плоскости наличника внутрь стены: переплёт, стекло на его середине, тюль за ним.
const SASH = { bar: 0.05, mullion: 0.035, transom: 0.68, front: 0.06, back: 0.11, paint: [0.92, 0.92, 0.88] };
const GLASS = 0.085, TULLE = 0.14;

const [map, tulleMap] = tiles(['assets/textures/house-nalichnik.webp', 'assets/textures/house-tulle.jpg']);
const trimMaterials = PAINTS.map((paint) => new THREE.MeshLambertMaterial({ map, color: new THREE.Color(...paint), alphaTest: 0.5 }));
const sashMaterial = new THREE.MeshLambertMaterial({ color: new THREE.Color(...SASH.paint) });
const tulleMaterial = new THREE.MeshLambertMaterial({ map: tulleMap });
const glassMaterial = new THREE.MeshBasicMaterial({ color: 0xc4d6e8, transparent: true, opacity: 0.22, depthWrite: false });

// Набор граней одной сетки; face кладёт четырёхугольник лицом к normal (обход сам подбирается по нормали).
class Faces {
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
  // Края рамы наличника относительно низа и середины проёма, в метрах; u, v — места в атласе.
  const left = m(FRAME.x[0] - OPENING.x[0], 0), right = m(FRAME.x[1] - OPENING.x[0], 0) - PANE[0];
  const below = m(OPENING.y[1] - FRAME.y[1], 1), above = m(OPENING.y[1] - FRAME.y[0], 1);
  const u = [FRAME.x[0], FRAME.x[1]].map((x) => (pattern + x / PX[0]) / COUNT);
  const v = [FRAME.y[1], FRAME.y[0]].map((y) => 1 - y / PX[1]);
  const [w, h] = PANE;
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
    rect(trims, -w / 2 + left, w / 2 + right, below, above, 0, [[u[0], v[0]], [u[1], v[0]], [u[1], v[1]], [u[0], v[1]]]);
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
  return new THREE.Group().add(trims.mesh(trimMaterials[paint]), sash.mesh(sashMaterial), tulles.mesh(tulleMaterial), glass.mesh(glassMaterial));
}

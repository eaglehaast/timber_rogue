import * as THREE from 'three';
import { KIT, atlas, cell } from './kit.js';
import { Faces, PAINTS } from './window.js';

// Резьба фронтонов и чердачное окно — картинки Никиты на прозрачном фоне.
// Причелины — доски по краю скатов под свесом крыши, резной край книзу; сходятся у конька встык, отвесным резом.
// Фриз (подзор) — резная доска поперёк фасада под фронтоном и вдоль свесов на боках, торцами — к причелинам.
// Обе ленты — 2048 × 512, т. е. HEIGHT в высоту на 4·HEIGHT вдоль; узор повторяется целым числом раз (чуть
// растянут под длину доски). Красит их код, как наличники: белая картинка, умноженная на краску наличников.
// Толщина — как у наличника: по силуэтам картинок (tools/carving.py → house-carving.json) доска получает торцы
// глубиной THICK, лицо и тыл — сама картинка.
const HEIGHT = 0.22, THICK = 0.03;
const TILE = 4 * HEIGHT;
const SHAPES = await (await fetch('assets/textures/house-carving.json')).json();
// Чердачное окно — по центру фронтона; его размер — пиксели картинки, делённые на PX_PER_M; низ — на SILL над
// верхом фасадной стены. Окно не крашено (старое дерево, как нарисовано).
const PX_PER_M = 1280, SILL = 0.35;

const painted = (name, paint, alphaTest) => new THREE.MeshLambertMaterial({ map: atlas(name), color: new THREE.Color(...paint), alphaTest });
const materials = Object.fromEntries(['frieze', 'prichelina'].map((name) => [name,
  PAINTS.map((paint) => ({ faces: painted(name, paint, 0.5), edges: painted(name, paint, 0) }))]));
const atticMaterial = new THREE.MeshLambertMaterial({ map: atlas('attic'), alphaTest: 0.5 });

// Резная доска картинки index набора name длиной length: точка лица — origin + along·t + up·h (t — метры вдоль,
// h — от 0 у низа картинки до 1 у верха), normal — куда смотрит лицо. Лицо и тыл кладутся в faces, торцы — в edges.
function carvedBoard(faces, edges, name, index, length, origin, along, up, normal) {
  const [u0, v0, u1, v1] = cell(name, index), { px: [W, H], outlines } = SHAPES[name];
  const count = Math.max(1, Math.round(length / TILE)), tile = length / count;
  const point = (t, h, depth) => origin.clone().addScaledVector(along, t).addScaledVector(up, h).addScaledVector(normal, depth);
  const texel = (x, y) => [u0 + (x / W) * (u1 - u0), v1 - (y / H) * (v1 - v0)];
  for (let k = 0; k < count; k++) {
    const t0 = k * tile, t1 = t0 + tile;
    for (const side of [1, -1]) {
      const d = (side * THICK) / 2;
      faces.face([point(t0, 0, d), point(t1, 0, d), point(t1, 1, d), point(t0, 1, d)].map((p) => p.toArray()),
        normal.clone().multiplyScalar(side).toArray(), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    }
    // Торцы по силуэту. На стыке соседних картинок торца нет — доска там сплошная; на концах доски есть.
    const at = (x, y) => [t0 + (x / W) * tile, 1 - y / H];
    for (const flat of outlines[index]) {
      for (let i = 0; i < flat.length; i += 2) {
        const j = (i + 2) % flat.length, [x, y, x2, y2] = [flat[i], flat[i + 1], flat[j], flat[j + 1]];
        if ((x <= 1 && x2 <= 1 && k > 0) || (x >= W - 1 && x2 >= W - 1 && k < count - 1)) continue;
        // Дерево справа по ходу (y вниз), наружу — влево; краска — с пикселя чуть внутри.
        const len = Math.hypot(x2 - x, y2 - y), nx = (y2 - y) / len, ny = -(x2 - x) / len;
        const [p, q] = [at(x, y), at(x2, y2)];
        const outward = along.clone().multiplyScalar(nx * tile / W).addScaledVector(up, -ny / H);
        const edge = point(...q, 0).sub(point(...p, 0)), n3 = edge.cross(normal).normalize();
        if (n3.dot(outward) < 0) n3.negate();
        const tp = texel(x - nx * 8, y - ny * 8), tq = texel(x2 - nx * 8, y2 - ny * 8);
        edges.face([point(...p, THICK / 2), point(...q, THICK / 2), point(...q, -THICK / 2), point(...p, -THICK / 2)].map((v) => v.toArray()),
          n3.toArray(), [tp, tq, tq, tp]);
      }
    }
  }
}

// Резьба дома plan. Крыша: ridge — высота конька, pitch — уклон, reach — свес от середины дома по x,
// gable — z лица фронтонов, barge — z причелин, front — верх фасадной стены (низ фронтона), out — z лица брёвен
// фасада с запасом, span — полуширина фасада между остатками брёвен на углах, zEnd — полудлина крыши.
export function buildCarving({ carving, attic, windows: { paint } }, { ridge, pitch, reach, gable, barge, front, out, span, zEnd }) {
  const tan = Math.tan(pitch), group = new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(x, y, z), up = V(0, HEIGHT, 0);
  if (carving) {
    const boards = [new Faces(), new Faces()], friezes = [new Faces(), new Faces()];
    const slope = reach / Math.cos(pitch);
    for (const face of [-1, 1]) {
      // Причелины: от конька вниз по скату, верх картинки — по скату, низ висит отвесно. Лицо доски — на barge.
      for (const s of [-1, 1]) {
        carvedBoard(...boards, 'prichelina', carving.prichelina, slope, V(0, ridge - HEIGHT, face * (barge - THICK / 2)),
          V(s * Math.cos(pitch), -Math.sin(pitch), 0), up, V(0, 0, face));
      }
      // Фриз поперёк фасада между углами: верх — над низом фронтона, висит перед верхними брёвнами;
      // картинка идёт слева направо для того, кто смотрит на фасад.
      carvedBoard(...friezes, 'frieze', carving.frieze, 2 * span, V(-face * span, front + 0.1 - HEIGHT, face * (out + THICK / 2)),
        V(face, 0, 0), up, V(0, 0, face));
      // Подзор вдоль свеса бока: висит под краем ската, концами упирается в причелины.
      const x = face * (reach - 0.06), eave = ridge - (reach - 0.06) * tan - 0.02, end = barge - THICK;
      carvedBoard(...friezes, 'frieze', carving.frieze, 2 * end, V(x, eave - HEIGHT, face * end), V(0, 0, -face), up, V(face, 0, 0));
    }
    const { prichelina, frieze } = materials;
    group.add(boards[0].mesh(prichelina[paint].faces), boards[1].mesh(prichelina[paint].edges),
      friezes[0].mesh(frieze[paint].faces), friezes[1].mesh(frieze[paint].edges));
  }
  // Чердачное окно, если влезает под скаты (с запасом на причелину).
  if (attic === null) return group;
  const [x, y, w, h, pw, ph] = KIT.attic.rects[attic], [u0, v0, u1, v1] = cell('attic', attic), size = 512;
  const width = pw / PX_PER_M, height = ph / PX_PER_M, bottom = front + SILL;
  if (bottom + height < ridge - (width / 2) * tan - HEIGHT) {
    const windows = new Faces();
    const uv = (a, b) => [u0 + (a / size) * (u1 - u0), v1 - (b / size) * (v1 - v0)];
    for (const face of [-1, 1]) {
      const z = face * (gable + 0.025);
      windows.face([[-width / 2, bottom, z], [width / 2, bottom, z], [width / 2, bottom + height, z], [-width / 2, bottom + height, z]], [0, 0, face],
        face > 0 ? [uv(x, y + h), uv(x + w, y + h), uv(x + w, y), uv(x, y)] : [uv(x + w, y + h), uv(x, y + h), uv(x, y), uv(x + w, y)]);
    }
    group.add(windows.mesh(atticMaterial));
  }
  return group;
}

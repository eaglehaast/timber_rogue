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
// Фриз фасада поднят над верхом стены на FRIEZE_UP; между ним и кокошниками наличников — не меньше GAP.
// TRIM_ROOM — на сколько ниже верха фасадной стены кончаются наличники (house.js по нему ставит окна).
// Подзор бока вешаем, только если он тоже не доходит до наличников этой стены на GAP.
const FRIEZE_UP = 0.1, GAP = 0.06;
export const TRIM_ROOM = HEIGHT - FRIEZE_UP + GAP;
const SHAPES = await (await fetch('assets/textures/house-carving.json')).json();
// Чердачное окно — по центру фронтона, высоко, под коньком: верх на UNDER ниже причелин над его углами (не ниже
// SILL над фасадной стеной). Размер — пиксели картинки, делённые на PX_PER_M. Толщина — по силуэту, как у резьбы;
// краска — наличников.
const PX_PER_M = 1280, SILL = 0.35, UNDER = 0.2;

// Краска — как у наличника, а оттенок картинки приведён к наличниковому (tint): иначе белая на желтоватом рисунке желтеет.
const painted = (name, paint, alphaTest) => new THREE.MeshLambertMaterial({
  map: atlas(name), color: new THREE.Color(...paint.map((v, k) => (v * SHAPES.nalichnik.tint[k]) / SHAPES[name].tint[k])), alphaTest,
});
// Стекло чердачного окна — тёмные пиксели картинки (яркость ниже GLASS.dark) — не крашено и светлее в GLASS.glow раз:
// у чердака два окна, свет проходит насквозь, и за стеклом не чернота, а сумрак.
const GLASS = { dark: [0.06, 0.12], glow: 3.5 };
function glassy(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
        float glass = 1.0 - smoothstep(${GLASS.dark[0].toFixed(3)}, ${GLASS.dark[1].toFixed(3)}, dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114)));
        diffuseColor.rgb = mix(diffuseColor.rgb, sampledDiffuseColor.rgb * ${GLASS.glow.toFixed(2)}, glass);
      #endif`);
  };
  material.customProgramCacheKey = () => 'attic glass';
  return material;
}
const materials = Object.fromEntries(['frieze', 'prichelina', 'attic'].map((name) => [name,
  PAINTS.map((paint) => {
    const faces = painted(name, paint, 0.5);
    return { faces: name === 'attic' ? glassy(faces) : faces, edges: painted(name, paint, 0) };
  })]));

// Резная доска картинки index набора name длиной length: точка лица — origin + along·t + up·h (t — метры вдоль,
// h — от 0 у низа картинки до 1 у верха), normal — куда смотрит лицо. Лицо и тыл кладутся в faces, торцы — в edges.
// Картинка повторяется count раз; rect — где она в клетке атласа, в пикселях [x, y, ширина, высота].
function carvedBoard(faces, edges, name, index, length, origin, along, up, normal,
  count = Math.max(1, Math.round(length / TILE)), rect = [0, 0, ...SHAPES[name].px]) {
  const [u0, v0, u1, v1] = cell(name, index), { px: [W, H], outlines } = SHAPES[name], [rx, ry, rw, rh] = rect, tile = length / count;
  const point = (t, h, depth) => origin.clone().addScaledVector(along, t).addScaledVector(up, h).addScaledVector(normal, depth);
  const texel = (x, y) => [u0 + (x / W) * (u1 - u0), v1 - (y / H) * (v1 - v0)];
  const [a0, b1] = texel(rx, ry), [a1, b0] = texel(rx + rw, ry + rh);
  for (let k = 0; k < count; k++) {
    const t0 = k * tile, t1 = t0 + tile;
    for (const side of [1, -1]) {
      const d = (side * THICK) / 2;
      faces.face([point(t0, 0, d), point(t1, 0, d), point(t1, 1, d), point(t0, 1, d)].map((p) => p.toArray()),
        normal.clone().multiplyScalar(side).toArray(), [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]);
    }
    // Торцы по силуэту. На стыке соседних картинок торца нет — доска там сплошная; на концах доски есть.
    const at = (x, y) => [t0 + ((x - rx) / rw) * tile, 1 - (y - ry) / rh];
    for (const flat of outlines[index]) {
      for (let i = 0; i < flat.length; i += 2) {
        const j = (i + 2) % flat.length, [x, y, x2, y2] = [flat[i], flat[i + 1], flat[j], flat[j + 1]];
        if ((x <= rx + 1 && x2 <= rx + 1 && k > 0) || (x >= rx + rw - 1 && x2 >= rx + rw - 1 && k < count - 1)) continue;
        // Дерево справа по ходу (y вниз), наружу — влево; краска — с пикселя чуть внутри.
        const len = Math.hypot(x2 - x, y2 - y), nx = (y2 - y) / len, ny = -(x2 - x) / len;
        const [p, q] = [at(x, y), at(x2, y2)];
        const outward = along.clone().multiplyScalar((nx * tile) / rw).addScaledVector(up, -ny / rh);
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
// фасада с запасом, span — полуширина фасада между остатками брёвен на углах, zEnd — полудлина крыши,
// trims — высота верха наличников на левой (−1) и правой (1) стене.
export function buildCarving({ carving, attic, windows: { paint } }, { ridge, pitch, reach, gable, barge, front, out, span, zEnd, trims }) {
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
      carvedBoard(...friezes, 'frieze', carving.frieze, 2 * span, V(-face * span, front + FRIEZE_UP - HEIGHT, face * (out + THICK / 2)),
        V(face, 0, 0), up, V(0, 0, face));
      // Подзор вдоль свеса бока: висит под краем ската, концами упирается в причелины.
      const x = face * (reach - 0.06), eave = ridge - (reach - 0.06) * tan - 0.02, end = barge - THICK;
      if (eave - HEIGHT >= trims[face] + GAP) carvedBoard(...friezes, 'frieze', carving.frieze, 2 * end, V(x, eave - HEIGHT, face * end), V(0, 0, -face), up, V(face, 0, 0));
    }
    const { prichelina, frieze } = materials;
    group.add(boards[0].mesh(prichelina[paint].faces), boards[1].mesh(prichelina[paint].edges),
      friezes[0].mesh(frieze[paint].faces), friezes[1].mesh(frieze[paint].edges));
  }
  // Чердачное окно, если влезает под скаты (с запасом на причелину).
  if (attic === null) return group;
  const [x, y, w, h, pw, ph] = KIT.attic.rects[attic], width = pw / PX_PER_M, height = ph / PX_PER_M;
  const bottom = ridge - (width / 2) * tan - HEIGHT - UNDER - height;
  if (bottom >= front + SILL) {
    const windows = [new Faces(), new Faces()];
    for (const face of [-1, 1]) {
      carvedBoard(...windows, 'attic', attic, width, V(-face * width / 2, bottom, face * (gable + THICK / 2 + 0.005)),
        V(face, 0, 0), V(0, height, 0), V(0, 0, face), 1, [x, y, w, h]);
    }
    group.add(windows[0].mesh(materials.attic[paint].faces), windows[1].mesh(materials.attic[paint].edges));
  }
  return group;
}

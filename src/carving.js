import * as THREE from 'three';
import { KIT, atlas, cell, repaint, strip } from './kit.js';
import { Faces, PAINTS } from './window.js';

// Резьба фронтонов и чердачное окно — картинки Никиты на прозрачном фоне.
// Причелины — доски по краю скатов под свесом крыши, резной край книзу; на двух скатах узор зеркальный.
// Фриз (подзор) — резная доска поперёк фасада под фронтоном и вдоль свесов на боках.
// Обе ленты — 2048 × 512, т. е. HEIGHT в высоту на 4·HEIGHT вдоль; узор повторяется. Нарисованы белым по дереву,
// красит их код — той же краской, что наличники.
const HEIGHT = 0.32;
const TILE = 4 * HEIGHT;
// Чердачное окно — по центру фронтона; его размер — пиксели картинки, делённые на PX_PER_M; низ — на SILL над
// верхом фасадной стены. Окно не крашено (старое дерево, как нарисовано).
const PX_PER_M = 1280, SILL = 0.35;

const material = (name, paint) => new THREE.MeshLambertMaterial({ map: atlas(name), color: paint && repaint(name, paint), alphaTest: 0.5, side: THREE.DoubleSide });
const materials = Object.fromEntries(['frieze', 'prichelina'].map((name) => [name, PAINTS.map((paint) => material(name, paint))]));
const atticMaterial = new THREE.MeshLambertMaterial({ map: atlas('attic'), alphaTest: 0.5 });

// Резьба дома plan. Крыша: ridge — высота конька, pitch — уклон, reach — свес от середины дома по x,
// gable — z лица фронтонов, barge — z причелин, front — верх фасадной стены (низ фронтона), out — z лица брёвен
// фасада с запасом, span — полуширина фасада между остатками брёвен на углах, zEnd — полудлина крыши.
export function buildCarving({ carving, attic, windows: { paint } }, { ridge, pitch, reach, gable, barge, front, out, span, zEnd }) {
  const tan = Math.tan(pitch), group = new THREE.Group();
  if (carving) {
    const boards = new Faces(), friezes = new Faces();
    const prichelina = cell('prichelina', carving.prichelina), frieze = cell('frieze', carving.frieze);
    const slope = reach / Math.cos(pitch);
    for (const face of [-1, 1]) {
      // Причелины: от конька вниз по скату, верх картинки — по скату, низ висит отвесно на HEIGHT.
      for (const s of [-1, 1]) {
        const dir = new THREE.Vector3(s * Math.cos(pitch), -Math.sin(pitch), 0);
        const at = (t, h) => new THREE.Vector3(0, ridge - (1 - h) * HEIGHT, face * barge).addScaledVector(dir, t).toArray();
        strip(boards, prichelina, slope, TILE, at, [0, 0, face]);
      }
      // Фриз поперёк фасада: верх — над низом фронтона, висит перед верхними брёвнами между углами.
      strip(friezes, frieze, 2 * span, TILE, (t, h) => [-span + t, front + 0.1 - (1 - h) * HEIGHT, face * out], [0, 0, face]);
      // Подзор вдоль свеса бока: висит под краем ската.
      const x = face * (reach - 0.06), eave = ridge - (reach - 0.06) * tan - 0.02;
      strip(friezes, frieze, 2 * zEnd, TILE, (t, h) => [x, eave - (1 - h) * HEIGHT, -zEnd + t], [face, 0, 0]);
    }
    group.add(boards.mesh(materials.prichelina[paint]), friezes.mesh(materials.frieze[paint]));
  }
  // Чердачное окно, если влезает под скаты (с запасом на причелину).
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

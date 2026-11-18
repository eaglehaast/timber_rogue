import * as THREE from 'three';

// «Подушка» по силуэту картинки: лицевой лист смотрит на +z, тыльный — на −z, и по краю силуэта они
// сходятся, как у надутой наволочки. Так собраны корпус пилы (tools/saw.py) и перчатка (tools/hands.py).
// Форму задаёт карта shape по клеткам cell пикселей картинки размером size: в красном — z лицевого листа,
// в синем — z тыльного (128 + полмиллиметра на единицу), в зелёном — расстояние до края силуэта
// в шестнадцатых клетки (128 — край). Пиксель (px, py) встаёт в точку (x(px), y(py)).
// Толщину можно задать и функцией depth(px, py, d) → [z лица, z тыла] (м) по пикселю и расстоянию d до края
// (в пикселях): у пологого листа ступеньки по полмиллиметра видны полосами, а расстояние до края точнее.
// Край проводим по клеткам, как изолинию (marching squares): где зелёный переходит через 128, ставим вершину
// на ребре клетки, и там оба листа сходятся. Сначала идут треугольники лица, за ними тыла: это группы 0 и 1,
// у каждого листа своя картинка. edge — номера вершин края.
export function pillow(shape, cell, [width, height], x, y, depth = null) {
  const cols = shape.width, rows = shape.height, pixels = pixelsOf(shape);
  const at = ([i, j], channel) => pixels[4 * (j * cols + i) + channel] - 128;
  const dist = (c) => at(c, 1);
  const sheets = depth
    ? (c) => depth((c[0] + 0.5) * cell, (c[1] + 0.5) * cell, (dist(c) / 16) * cell)
    : (c) => [at(c, 0) / 2000, at(c, 2) / 2000];
  const middle = (c) => (sheets(c)[0] + sheets(c)[1]) / 2;
  const position = [], uv = [], front = [], back = [], shared = new Map(), edge = new Set();
  // Вершина на пикселе (px, py): лицевая копия, за ней тыльная.
  const vertex = (key, px, py, zf, zb) => {
    if (!shared.has(key)) {
      shared.set(key, position.length / 3);
      position.push(x(px), y(py), zf, x(px), y(py), zb);
      uv.push(px / width, 1 - py / height, px / width, 1 - py / height);
    }
    return shared.get(key);
  };
  const corner = (c) => vertex(c[1] * cols + c[0], (c[0] + 0.5) * cell, (c[1] + 0.5) * cell, ...sheets(c));
  const mark = (index) => { edge.add(index); return index; };
  const crossing = (a, b) => {
    const t = dist(a) / (dist(a) - dist(b)), ka = a[1] * cols + a[0], kb = b[1] * cols + b[0];
    const z = (1 - t) * middle(a) + t * middle(b);
    return mark(vertex(`${Math.min(ka, kb)}-${Math.max(ka, kb)}`,
      (a[0] + t * (b[0] - a[0]) + 0.5) * cell, (a[1] + t * (b[1] - a[1]) + 0.5) * cell, z, z));
  };
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const ring = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], poly = [];
      ring.forEach((a, k) => {
        const b = ring[(k + 1) % 4];
        if (dist(a) > 0) poly.push(corner(a));
        if ((dist(a) > 0) !== (dist(b) > 0)) poly.push(crossing(a, b));
      });
      // Обход клетки идёт по часовой стрелке, если смотреть с +z: лицевой лист разворачиваем.
      for (let k = 1; k < poly.length - 1; k++) {
        front.push(poly[0], poly[k + 1], poly[k]);
        back.push(poly[0] + 1, poly[k] + 1, poly[k + 1] + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex([...front, ...back]);
  geometry.computeVertexNormals();
  geometry.addGroup(0, front.length, 0);
  geometry.addGroup(front.length, back.length, 1);
  return { geometry, edge };
}

// Пиксели картинки подряд: RGBA, строка за строкой.
export function pixelsOf(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height).data;
}

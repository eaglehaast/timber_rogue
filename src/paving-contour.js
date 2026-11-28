// Внешние части границ объединения многоугольников, без внутренних швов.
const cross = (ax, az, bx, bz) => ax * bz - az * bx;
const pointAt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

function contains(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function indexPaving(shapes) {
  const outlines = shapes.map(({ polygon }) => {
    const segments = polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]])
      .filter(([a, b]) => Math.hypot(a.x - b.x, a.z - b.z) > 1e-8);
    return {
      segments,
      minX: Math.min(...polygon.map((p) => p.x)), maxX: Math.max(...polygon.map((p) => p.x)),
      minZ: Math.min(...polygon.map((p) => p.z)), maxZ: Math.max(...polygon.map((p) => p.z)),
    };
  });
  const cells = new Map(), cellSize = 1;
  outlines.forEach((box, i) => {
    for (let x = Math.floor(box.minX / cellSize); x <= Math.floor(box.maxX / cellSize); x++) {
      for (let z = Math.floor(box.minZ / cellSize); z <= Math.floor(box.maxZ / cellSize); z++) {
        const key = `${x},${z}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
      }
    }
  });
  const nearby = (a, b) => {
    const found = new Set();
    for (let x = Math.floor((Math.min(a.x, b.x) - 0.001) / cellSize); x <= Math.floor((Math.max(a.x, b.x) + 0.001) / cellSize); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - 0.001) / cellSize); z <= Math.floor((Math.max(a.z, b.z) + 0.001) / cellSize); z++) {
        for (const i of cells.get(`${x},${z}`) ?? []) found.add(i);
      }
    }
    return [...found];
  };
  return { outlines, nearby };
}

export function pavingContains(shapes) {
  const { nearby } = indexPaving(shapes);
  return (x, z) => nearby({ x, z }, { x, z }).some((i) => contains(shapes[i].polygon, { x, z }));
}

// Пересекается ли круг с мощением, включая его край.
export function pavingIntersects(shapes) {
  const { outlines, nearby } = indexPaving(shapes);
  return (x, z, radius = 0) => {
    const point = { x, z };
    return nearby({ x: x - radius, z: z - radius }, { x: x + radius, z: z + radius }).some((i) => {
      if (contains(shapes[i].polygon, point)) return true;
      return outlines[i].segments.some(([a, b]) => {
        const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2));
        return (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2 <= radius * radius;
      });
    });
  };
}

export function exposedPavingEdges(shapes) {
  const { outlines, nearby } = indexPaving(shapes);
  const result = [], seen = new Set();
  const key = (p) => `${Math.round(p.x * 100000)},${Math.round(p.z * 100000)}`;
  shapes.forEach(({ edges }, own) => {
    for (const [a, b] of edges) {
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (length < 1e-8) continue;
      const relevant = nearby(a, b).filter((i) => {
        const box = outlines[i];
        return Math.max(a.x, b.x) + 0.001 >= box.minX && Math.min(a.x, b.x) - 0.001 <= box.maxX
          && Math.max(a.z, b.z) + 0.001 >= box.minZ && Math.min(a.z, b.z) - 0.001 <= box.maxZ;
      });
      const cuts = [0, 1];
      for (const i of relevant) if (i !== own) for (const [c, d] of outlines[i].segments) {
        const ex = d.x - c.x, ez = d.z - c.z, det = cross(dx, dz, ex, ez);
        if (Math.abs(det) < 1e-10) {
          if (Math.abs(cross(c.x - a.x, c.z - a.z, dx, dz)) < 1e-8) {
            for (const p of [c, d]) {
              const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / (length * length);
              if (t > 1e-8 && t < 1 - 1e-8) cuts.push(t);
            }
          }
          continue;
        }
        const t = cross(c.x - a.x, c.z - a.z, ex, ez) / det;
        const u = cross(c.x - a.x, c.z - a.z, dx, dz) / det;
        if (t > 1e-8 && t < 1 - 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) cuts.push(t);
      }
      cuts.sort((x, y) => x - y);
      for (let k = 1; k < cuts.length; k++) {
        if (cuts[k] - cuts[k - 1] < 1e-8) continue;
        const mid = pointAt(a, b, (cuts[k] + cuts[k - 1]) / 2);
        const nx = -dz / length * 0.0001, nz = dx / length * 0.0001;
        const inside = (x, z) => relevant.some((i) => contains(shapes[i].polygon, { x, z }));
        if (inside(mid.x + nx, mid.z + nz) !== inside(mid.x - nx, mid.z - nz)) {
          const first = pointAt(a, b, cuts[k - 1]), last = pointAt(a, b, cuts[k]);
          const ka = key(first), kb = key(last), edgeKey = ka < kb ? `${ka}:${kb}` : `${kb}:${ka}`;
          if (!seen.has(edgeKey)) { seen.add(edgeKey); result.push([first, last]); }
        }
      }
    }
  });
  return result;
}

// Соединяем обрезанные отрезки в цепи, чтобы шаг не сбрасывался на каждой вершине.
export function borderPoints(segments, spacing) {
  const key = (p) => `${Math.round(p.x * 100000)},${Math.round(p.z * 100000)}`;
  const nodes = new Map(), links = [];
  for (const [a, b] of segments) {
    const ka = key(a), kb = key(b);
    if (ka === kb) continue;
    for (const [k, p] of [[ka, a], [kb, b]]) if (!nodes.has(k)) nodes.set(k, { p, links: [] });
    const link = { a: ka, b: kb, used: false };
    nodes.get(ka).links.push(link); nodes.get(kb).links.push(link); links.push(link);
  }
  const posts = [];
  const add = (p) => {
    if (!posts.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < spacing * 0.45)) posts.push(p);
  };
  const trace = (start) => {
    let node = nodes.get(start), remaining = 0;
    add(node.p);
    for (;;) {
      const link = node.links.find((l) => !l.used);
      if (!link) { add(node.p); return; }
      link.used = true;
      const next = nodes.get(link.a === key(node.p) ? link.b : link.a);
      const length = Math.hypot(next.p.x - node.p.x, next.p.z - node.p.z);
      while (remaining + spacing <= length) {
        remaining += spacing;
        add(pointAt(node.p, next.p, remaining / length));
      }
      remaining -= length;
      node = next;
    }
  };
  for (const [k, node] of nodes) if (node.links.length === 1 && !node.links[0].used) trace(k);
  for (const link of links) if (!link.used) trace(link.a);
  return posts;
}

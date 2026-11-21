export const ROUTE_TILE = 0.7;

export function snapRoute(value) {
  return Math.round(value / ROUTE_TILE) * ROUTE_TILE;
}

function segment(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [from];
  const count = Math.max(1, Math.ceil(length / ROUTE_TILE));
  const points = [];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    points.push({ x: from.x + dx * t, z: from.z + dz * t });
  }
  points.push(to);
  return points;
}

// Axis-aligned routes have one turn and keep pavers on 70 cm modules.
// 'z' goes first along Z, then along X; 'x' does the reverse.
export function axisRoute(from, to, first = 'z') {
  const elbow = first === 'z'
    ? { x: from.x, z: to.z }
    : { x: to.x, z: from.z };
  const points = [from];
  const firstLeg = segment(from, elbow);
  points.push(...firstLeg);
  for (const p of segment(elbow, to)) {
    if (Math.hypot(p.x - points[points.length - 1].x, p.z - points[points.length - 1].z) > 1e-6) points.push(p);
  }
  if (points[points.length - 1].x !== to.x || points[points.length - 1].z !== to.z) points.push(to);
  return points;
}

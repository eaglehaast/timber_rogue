export const ROUTE_TILE = 0.7;

function pointsAlong(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [];
  const count = Math.max(1, Math.ceil(length / ROUTE_TILE));
  const points = [];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    points.push({ x: from.x + dx * t, z: from.z + dz * t });
  }
  return points;
}

export function axisRoute(from, to, first = 'z') {
  const elbow = first === 'z'
    ? { x: from.x, z: to.z }
    : { x: to.x, z: from.z };
  const points = [from];
  for (const point of [...pointsAlong(from, elbow), elbow, ...pointsAlong(elbow, to), to]) {
    const last = points[points.length - 1];
    if (Math.hypot(point.x - last.x, point.z - last.z) > 1e-6) points.push(point);
  }
  return points;
}

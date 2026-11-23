import * as THREE from 'three';

export const ROUTE_SPACING = 0.12;

export function fitPavingCenter(center, halfWidth, yardHalfWidth, margin = 0) {
  const limit = yardHalfWidth - halfWidth - margin;
  if (limit < 0) throw new RangeError('Paving footprint does not fit inside the yard');
  return THREE.MathUtils.clamp(center, -limit, limit);
}

export function curvedRoute(anchors, spacing = ROUTE_SPACING) {
  const points = anchors.filter((point, i) => !i
    || Math.hypot(point.x - anchors[i - 1].x, point.z - anchors[i - 1].z) > 1e-4);
  if (points.length < 2) return points;
  const curve = new THREE.CatmullRomCurve3(
    points.map(({ x, z }) => new THREE.Vector3(x, 0, z)),
    false,
    'centripetal',
  );
  const count = Math.max(points.length * 2, Math.ceil(curve.getLength() / spacing));
  return curve.getSpacedPoints(count).map(({ x, z }) => ({ x, z }));
}

export function planPathNetwork({ gate, porch, porchApproach, pad, padApproach, bath, bathApproach, house }) {
  const lerp = (a, b, t) => a + (b - a) * t;
  const targetX = (porch.x + pad.x + bath.x) / 3;
  const junction = { x: lerp(gate.x, targetX, 0.26), z: gate.z - 4.4 };
  const houseSide = Math.sign(gate.x - house.x) || 1;
  const houseEdge = house.x + houseSide * (house.w / 2 + 1.5);
  const bathSide = { x: houseEdge, z: house.z };
  const bathBack = { x: houseEdge, z: house.z - house.d / 2 - 1.4 };
  const midpoint = (a, b, bend) => {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz) || 1;
    return {
      x: (a.x + b.x) / 2 - (dz / length) * bend,
      z: (a.z + b.z) / 2 + (dx / length) * bend,
    };
  };
  const approach = {
    porch: porchApproach ?? midpoint(porch, junction, 1.2),
    pad: padApproach ?? { x: pad.x, z: pad.z + 1.2 },
    bath: bathApproach ?? midpoint(bath, bathBack, 1.2),
  };
  return {
    junction,
    routes: [
      { destination: 'gate', points: curvedRoute([gate, midpoint(gate, junction, 0.35), junction]) },
      { destination: 'house', points: curvedRoute([junction, midpoint(junction, porch, 0.65), approach.porch, porch]) },
      { destination: 'utility', points: curvedRoute([junction, midpoint(junction, pad, houseSide * 0.9), approach.pad, pad]) },
      { destination: 'bath', points: curvedRoute([junction, bathSide, bathBack, approach.bath, bath]) },
    ],
  };
}

import * as THREE from 'three';

// Щепки из-под цепи. Цепь выносит их из пропила и бросает по своему ходу; в воздухе их быстро
// тормозит, они падают и остаются лежать опилками. Настоящих щепок на рез — десятки тысяч, здесь
// каждая — за многих: из ствола в 20 см их летит около тысячи в секунду.
const MAX = 20000;         // столько щепок лежит сразу; новые занимают место самых старых
const PER_M3 = 3e6;        // щепок на кубометр выпиленной древесины
const SPEED = 6;           // м/с — быстрее цепь щепку не бросает: такая улетает метра на полтора
const FAN = 0.5;           // струя расходится конусом: в сторону щепка уходит не больше чем на половину пути
const DRAG = 3;            // 1/с — так быстро воздух гасит скорость лёгкой щепки
const SPIN = 30;           // рад/с — так щепка кувыркается в полёте
const GRAVITY = 9.8;
const WOOD = new THREE.Color(0xf1e8d2); // свежий клён — почти белый, чуть в сливки

export class Chips extends THREE.InstancedMesh {
  constructor() {
    // Щепка тонкая и просвечивает: светлая и с теневой стороны, поэтому чуть светится сама.
    super(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, emissive: WOOD, emissiveIntensity: 0.3 }), MAX);
    this.count = 0;
    this.frustumCulled = false; // щепки разлетаются по двору, а не сидят вокруг начала координат
    this.receiveShadow = true;
    this.flying = [];
    this.next = 0;
    this.due = 0; // доля щепки, что набежала с прошлых кадров
  }

  // Цепь выпилила volume (м³) и выходит из древесины в точке at, двигаясь по направлению dir.
  // Струя — конус: в сторону щепка уходит тем дальше, чем дальше улетела, и куча ложится веером от реза.
  // Скорости — от нуля до SPEED поровну: щепки ложатся по всей длине веера, а у реза, где он узок, их гуще.
  spray(at, dir, volume) {
    for (this.due += volume * PER_M3; this.due >= 1; this.due--) {
      const chip = {
        i: this.next,
        p: at.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(0.005)),
        v: dir.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(FAN * Math.random())).multiplyScalar(SPEED * Math.random()),
        q: new THREE.Quaternion().random(),
        axis: new THREE.Vector3().randomDirection(),
        size: new THREE.Vector3(0.008 + Math.random() * 0.006, 0.004 + Math.random() * 0.004, 1),
      };
      this.flying.push(chip);
      this.setMatrixAt(chip.i, new THREE.Matrix4().compose(chip.p, chip.q, chip.size));
      this.setColorAt(chip.i, WOOD.clone().multiplyScalar(0.88 + Math.random() * 0.14));
      this.instanceColor.needsUpdate = true;
      this.next = (this.next + 1) % MAX;
      this.count = Math.max(this.count, this.next || MAX);
    }
  }

  // Полёт за dt: тяжесть тянет вниз, воздух тормозит. Упала на землю — ложится плашмя и больше не двигается.
  step(dt) {
    if (!this.flying.length) return;
    const m = new THREE.Matrix4(), turn = new THREE.Quaternion();
    this.flying = this.flying.filter((c) => {
      c.v.y -= GRAVITY * dt;
      c.v.multiplyScalar(Math.exp(-DRAG * dt));
      c.p.addScaledVector(c.v, dt);
      const landed = c.p.y <= 0.002;
      if (landed) {
        c.p.y = 0.002;
        c.q.setFromEuler(new THREE.Euler(-Math.PI / 2 + (Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, 0, 'YXZ'));
      } else c.q.multiply(turn.setFromAxisAngle(c.axis, SPIN * dt));
      this.setMatrixAt(c.i, m.compose(c.p, c.q, c.size));
      return !landed;
    });
    this.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.count = this.next = this.due = 0;
    this.flying = [];
  }
}

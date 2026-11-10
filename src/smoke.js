import * as THREE from 'three';
import { tiles } from './surface.js';

// Дым из печной трубы: клубы поднимаются, растут, сносятся ветром и тают. Клуб — акварельное облако неба
// снизу (cloud-below-*.webp): дым в том же стиле, что небо, только серее и прозрачнее.
// Клубов ровно столько, сколько их живёт одновременно; клуб, доживший до конца, снова выходит из трубы
// с новой картинкой, наклоном и разбросом.
const PUFF = {
  every: 0.3,                 // с — между клубами
  life: 9,                    // с — сколько живёт клуб
  rise: [0.7, 0.15],          // м/с — подъём у трубы и в конце жизни: дым остывает и замедляется
  wind: [0.32, 0, 0.1],       // м/с — снос ветром
  size: [0.25, 2.2],          // м — поперечник у трубы и в конце
  opacity: 0.6,
  tone: [0.4, 0.39, 0.39],    // печной дым серый, темнее неба (светлый выходил паром)
};
const COUNT = Math.ceil(PUFF.life / PUFF.every);
const aspects = await (await fetch('assets/textures/cloud-below.json')).json();
const maps = tiles(aspects.map((_, i) => `assets/textures/cloud-below-${i + 1}.webp`));
maps.forEach((m) => { m.wrapS = m.wrapT = THREE.ClampToEdgeWrapping; });

// Дым над точкой top (оголовок трубы, в координатах дома). tick(dt) двигает его во времени.
export class Smoke extends THREE.Group {
  constructor(top, rnd) {
    super();
    this.rnd = rnd;
    this.top = top;
    this.time = 0;
    this.puffs = Array.from({ length: COUNT }, () => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(...PUFF.tone),
      }));
      this.add(sprite);
      return { sprite, age: -1 };
    });
    // Дым уже идёт, когда на него смотрят: клубы сразу разложены по возрасту.
    this.puffs.forEach((puff, i) => this.renew(puff, i * PUFF.every));
    this.tick(0);
  }

  // Клуб снова у трубы, в возрасте age.
  renew(puff, age) {
    const { rnd } = this, k = Math.floor(rnd() * maps.length);
    Object.assign(puff, { age, spread: [rnd() - 0.5, rnd() - 0.5], sway: rnd() * 6.3, flip: rnd() < 0.5 ? -1 : 1, aspect: aspects[k] });
    puff.sprite.material.map = maps[k];
    puff.sprite.material.rotation = (rnd() - 0.5) * 0.8;
    puff.sprite.material.needsUpdate = true;
  }

  tick(dt) {
    this.time += dt;
    const { life, rise: [r0, r1], wind, size: [s0, s1], opacity } = PUFF;
    for (const puff of this.puffs) {
      puff.age += dt;
      if (puff.age >= life) this.renew(puff, puff.age - life);
      const a = puff.age, t = a / life;
      // Подъём — путь при скорости, плавно падающей от r0 до r1; снос — ветром, с покачиванием.
      const up = r0 * a + ((r1 - r0) * a * a) / (2 * life);
      const wobble = 0.15 * t * Math.sin(this.time * 0.6 + puff.sway);
      const s = s0 + (s1 - s0) * Math.sqrt(t);
      puff.sprite.position.set(
        this.top.x + wind[0] * a + puff.spread[0] * 0.4 * s + wobble,
        this.top.y + up + wind[1] * a,
        this.top.z + wind[2] * a + puff.spread[1] * 0.4 * s,
      );
      puff.sprite.scale.set(puff.flip * s, s / Math.sqrt(puff.aspect), 1);
      puff.sprite.material.opacity = opacity * Math.min(1, a / 0.5) * (1 - t) ** 1.5;
    }
  }
}

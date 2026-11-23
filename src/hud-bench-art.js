import { readLayout } from './hud-layout.js';

export const sawPoses = {
  asset: 'hands-saw-70', pressedAsset: 'hands-saw-70-pressed',
  shortAsset: 'hands-saw-30', shortPressedAsset: 'hands-saw-30-pressed',
};

export function addBenchArt(base) {
  const names = {
    'hands-saw-70': 'Руки · 70 см, газ отпущен', 'hands-saw-70-pressed': 'Руки · 70 см, газ нажат',
    'hands-saw-30': 'Руки · 30 см, газ отпущен', 'hands-saw-30-pressed': 'Руки · 30 см, газ нажат',
    'walk-ring': 'Ходьба · круг', 'walk-thumb': 'Ходьба · ручка',
    'hand-take': 'Руки · взять', 'hand-release': 'Руки · отпустить', 'cut-reverse': 'Пилить с другой стороны',
    'menu-back': 'Вернуться в меню', 'help': 'Управление', 'warning': 'Предупреждение',
    'tool-ground': 'Пила на земле', 'tool-pinched': 'Пилу зажало',
    'wood-embers': 'Отнести на угли', 'wood-stack': 'Отнести в поленницу',
  };
  for (const key of ['tool-long', 'tool-short', 'tool-gloves', 'trigger-rest', 'trigger-down']) names[key] = base.assets[key].name;
  for (const [key, name] of Object.entries(names)) base.assets[key] = { name, src: 'assets/hud/saw-bench/' + key + '.webp' };
  Object.assign(base.elements['held-saw'], sawPoses);
}

export function readBenchLayout(data, base) {
  const layout = readLayout(data, base);
  const saved = data.elements['held-saw'];
  if (!saved) return layout;
  const held = layout.elements['held-saw'];
  // В старом черновике на каждую шину был только один рисунок, общий для обоих положений газа.
  for (const [rest, down] of [['asset', 'pressedAsset'], ['shortAsset', 'shortPressedAsset']]) {
    if (Object.hasOwn(saved, down)) continue;
    const previous = saved[rest] ?? saved.asset;
    held[rest] = !previous || previous === 'saw-1' ? sawPoses[rest] : previous;
    held[down] = held[rest] === sawPoses[rest] ? sawPoses[down] : held[rest];
  }
  return layout;
}

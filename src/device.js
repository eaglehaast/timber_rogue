// Стенды рассчитаны на мышь. Сенсорный ноутбук с мышью тоже может их открыть.
export const PHONE = Boolean(navigator.userAgentData?.mobile) || /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 0 && !matchMedia('(any-pointer: fine)').matches);
const stand = new URLSearchParams(location.search).get('stand');
export const mode = stand === 'fly' || stand === 'hud' || stand === 'wood' ? stand : 'game';
export const texture = (file) => mode === 'game' ? file.replace('assets/textures/', 'assets/textures/half/') : file;

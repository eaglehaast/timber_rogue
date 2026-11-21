import * as THREE from 'three';

// Светлая черта на ближней кромке и редкие поперечные штрихи показывают направление реза.
// Узкая вертикальная грань делает черту видимой даже при взгляде точно вдоль полотна.
export function makeCutGuide() {
  const sheet = document.createElement('canvas');
  sheet.width = 256;
  sheet.height = 128;
  const ink = sheet.getContext('2d');
  const wash = ink.createLinearGradient(0, 128, 0, 0);
  wash.addColorStop(0, 'rgba(211,162,68,.35)');
  wash.addColorStop(.45, 'rgba(232,209,152,.12)');
  wash.addColorStop(1, 'rgba(232,209,152,.035)');
  ink.fillStyle = wash;
  ink.fillRect(0, 0, 256, 128);
  ink.strokeStyle = 'rgba(101,78,48,.85)';
  ink.lineWidth = 7;
  ink.beginPath(); ink.moveTo(4, 122); ink.lineTo(252, 122); ink.stroke();
  ink.strokeStyle = '#f7e4ab';
  ink.lineWidth = 3;
  ink.setLineDash([23, 5]);
  ink.stroke();
  ink.setLineDash([]);
  ink.lineWidth = 2;
  ink.beginPath();
  for (let x = 5; x < 256; x += 41) {
    ink.moveTo(x, 120); ink.lineTo(x, x === 128 ? 91 : 109);
  }
  ink.stroke();
  const texture = new THREE.CanvasTexture(sheet);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0,
    -.5, -.51, -.0035, .5, -.51, -.0035, .5, -.51, .0035, -.5, -.51, .0035,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1, 0, .03, 1, .03, 1, .065, 0, .065,
  ], 2));
  geometry.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]);
  const guide = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: texture, transparent: true, side: THREE.DoubleSide, forceSinglePass: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
  }));
  guide.name = 'cut-guide';
  return guide;
}

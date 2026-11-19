// Студия лампы: отражения, свет и прозрачный пол, на который падают только тени. Вызывается только в браузере.
// Размер и тональную компрессию рендерера задаёт код выше.
import * as THREE from 'three';
import type { LampModel } from '../lamp/model';

export interface Studio {
  scene: THREE.Scene;
  hemi: THREE.HemisphereLight;
  windowLight: THREE.DirectionalLight;
  spot: THREE.SpotLight;
  floor: THREE.ShadowMaterial;
  contact: THREE.MeshBasicMaterial;
}

/** Исходные значения света и пола (лампа выключена). */
export const LOOK = {
  off: { sky: 0x8ea3da, ground: 0x15140c, hemi: 0.13, window: 0.5, env: 0.2, contact: 0.5 },
};

/** Студия для отражений: один большой софтбокс, узкие полосы и тёмные стены. */
function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x0d0e11);
  const panel = (w: number, h: number, power: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 1.5, 0);
    env.add(m);
  };
  panel(11, 6, 9, -6, 9, 7);
  panel(1.6, 10, 7, 9, 4, -2);
  panel(16, 5, 3.2, 2, 3, 13);
  panel(1.4, 9, 6, -8, 3.5, 4);
  panel(40, 40, 0.5, 0, -6, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

/** Пятно тени под лампой. */
function contactShadow(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 3.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: LOOK.off.contact }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.004, 0.15);
  return m;
}

export function buildStudio(renderer: THREE.WebGLRenderer, lamp: LampModel): Studio {
  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = LOOK.off.env;

  // Пол прозрачный и показывает только тени: под ним виден HTML-фон.
  const floor = new THREE.ShadowMaterial({ opacity: 0.34 });
  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), floor);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  const hemi = new THREE.HemisphereLight(LOOK.off.sky, LOOK.off.ground, LOOK.off.hemi);
  scene.add(hemi);

  const windowLight = new THREE.DirectionalLight(0xa9c2ff, LOOK.off.window);
  windowLight.position.set(7, 7.5, -4.5);
  windowLight.castShadow = true;
  windowLight.shadow.mapSize.set(1024, 1024);
  windowLight.shadow.radius = 5;
  windowLight.shadow.normalBias = 0.03;
  windowLight.shadow.bias = -0.0002;
  {
    const c = windowLight.shadow.camera;
    c.left = -8; c.right = 8; c.top = 8; c.bottom = -8; c.near = 1; c.far = 34;
    c.updateProjectionMatrix();
  }
  scene.add(windowLight);

  const spot = new THREE.SpotLight(0xffa95c, 0, 0, 1.22, 1, 2);
  spot.position.set(0, 0, 0.3);
  spot.target.position.set(0, 0, 6);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.radius = 6;
  spot.shadow.bias = -0.0005;
  lamp.head.add(spot, spot.target);

  const contactMesh = contactShadow();
  lamp.spin.add(contactMesh);

  scene.add(lamp.root, lamp.beads, lamp.ring);
  return { scene, hemi, windowLight, spot, floor, contact: contactMesh.material };
}

// ЧЕРНОВОЙ ПРОТОТИП (spike), концепция «Выпуск»: одна вещь, огромная типографика позади предмета.
// Холст прозрачный: фон и крупный текст живут в HTML, сцена рисует только предмет, тени и свет.
// На выброс. Единицы сцены: 1 = 10 см. Лампа стоит в начале координат, пол в y = 0.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 0);
/** Плотность пикселей под бюджет: кадр в 16-битных буферах со сглаживанием стоит дорого, поэтому не больше ~2.4 млн пикселей. */
const pixelRatioFor = (w: number, h: number) => THREE.MathUtils.clamp(Math.sqrt(2.4e6 / (w * h)), 1, Math.min(window.devicePixelRatio, 1.5));
renderer.setPixelRatio(pixelRatioFor(window.innerWidth, window.innerHeight));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

// Кадр рисуется, только пока что-то движется. В покое страница не нагружает видеокарту вообще.
let awake = 40; // сколько кадров ещё рисовать после последнего изменения
function wake() { awake = Math.max(awake, 24); }

// Варианты названия бренда: переключаются кликом по логотипу, выбор запоминается в браузере.
const NAMES = ['Верст']; // название выбрано владельцем 2026-11-19
let brandName = NAMES[0];
try { brandName = localStorage.getItem('vs-name') ?? NAMES[0]; } catch { /* хранилище недоступно: остаётся первое название */ }
if (!NAMES.includes(brandName)) brandName = NAMES[0];
let repaintLabel = () => {};

const scene = new THREE.Scene();

/** Студия для отражений: один большой софтбокс, узкие полосы и тёмные стены. */
function studioEnvironment(): THREE.Texture {
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
scene.environment = studioEnvironment();

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);

// ---------- оформление сцены ----------
const LOOK = {
  floor: 0xf2c200,
  off: { sky: 0x8ea3da, ground: 0x15140c, hemi: 0.13, window: 0.5, env: 0.2, bg: 0x2b2707, contact: 0.5 },
  on: { ground: 0xb39a2c, hemi: 2.3, window: 0.3, env: 0.6, bg: 0xe2b600, contact: 0.3 },
  spot: 78,
  dots: 3.4, // яркость горящей точки (больше 1, чтобы давала свечение)
};

// Пол прозрачный и показывает только тени: под ним виден HTML-фон и крупный текст.
const floorMat = new THREE.ShadowMaterial({ opacity: 0.34 });
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}
/** Мягкое круглое пятно: им рисуются свет на столе и ореол панели. */
function softDisc(inner: string, outer: string): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, outer);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- текстуры ----------
/** Мелкое зерно литого пластика: без него корпус выглядит как гладкая 3D-заготовка. */
function grainTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const v = 150 + Math.floor(rnd() * 80);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 3.5);
  return t;
}
const grain = grainTexture();

function labelTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const paint = () => {
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
    t.needsUpdate = true;
    wake();
  };
  paint();
  // подписи рисуются шрифтом страницы: перерисовать, когда он загрузится
  document.fonts.load('500 40px "Golos Text"').then(paint, () => {});
  t.userData.repaint = paint;
  return t;
}

// ---------- материалы ----------
const bodyColor = new THREE.Color('#c2bfb6');
const shellMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.66, roughnessMap: grain, bumpMap: grain, bumpScale: 0.5 });
const coreMat = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.7 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x060607, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0xd2d3d6, metalness: 1, roughness: 0.26 });
const beadMat = new THREE.MeshStandardMaterial({ color: 0xcfd0d4, metalness: 1, roughness: 0.3 });
const knurlMat = new THREE.MeshStandardMaterial({ color: 0xc2c3c7, metalness: 1, roughness: 0.4, flatShading: true });
const rubberMat = new THREE.MeshStandardMaterial({ color: 0x121213, roughness: 0.92 });
const accentMat = new THREE.MeshStandardMaterial({ color: 0xf0541c, roughness: 0.48 });
const markMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.6 });

// ---------- лампа ----------
const PIVOT_Y = 2.3; // высота оси, на которой качается панель
const ARM_X = 1.42;
const lamp = new THREE.Group(); // крен от рывка шнура
const spin = new THREE.Group(); // вращение вокруг вертикали
const head = new THREE.Group(); // панель: качается на оси рамы
lamp.add(spin);
spin.add(head);
head.position.y = PIVOT_Y;
scene.add(lamp);

function add<T extends THREE.Object3D>(parent: THREE.Object3D, obj: T, cast = true): T {
  if ((obj as unknown as THREE.Mesh).isMesh) {
    obj.castShadow = cast;
    obj.receiveShadow = true;
  }
  parent.add(obj);
  return obj;
}

/** Винт с крестовым шлицем, головкой к +z. */
function screw(x: number, y: number, z: number, faceBack = false): THREE.Group {
  const g = new THREE.Group();
  const headMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.014, 20), steelMat);
  headMesh.rotation.x = Math.PI / 2;
  const slotA = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.009, 0.004), coreMat);
  const slotB = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.046, 0.004), coreMat);
  slotA.position.z = slotB.position.z = 0.0075;
  g.add(headMesh, slotA, slotB);
  g.position.set(x, y, z);
  g.rotation.z = (x * 7 + y * 3) % 1.2; // винты закручены каждый по-своему
  if (faceBack) g.rotation.y = Math.PI;
  return g;
}

// корпус из двух половин со швом между ними
const W = 2.6, H = 1.7;
const frontShell = add(head, new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.2, 5, 0.085), shellMat));
frontShell.position.z = 0.106;
const backShell = add(head, new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.2, 5, 0.085), shellMat));
backShell.position.z = -0.106;
add(head, new THREE.Mesh(new THREE.BoxGeometry(W - 0.05, H - 0.05, 0.1), coreMat), false);

// тёмное стекло и матрица точек за ним
const bezel = add(head, new THREE.Mesh(new RoundedBoxGeometry(2.3, 1.4, 0.02, 3, 0.04), glassMat), false);
bezel.position.z = 0.2;
const COLS = 24, ROWS = 14, PITCH = 0.09;
const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.03, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }), COLS * ROWS);
dots.frustumCulled = false;
{
  const m = new THREE.Matrix4();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      m.makeTranslation((c - (COLS - 1) / 2) * PITCH, ((ROWS - 1) / 2 - r) * PITCH, 0.2115);
      dots.setMatrixAt(r * COLS + c, m);
      dots.setColorAt(r * COLS + c, new THREE.Color(0.03, 0.03, 0.03));
    }
  }
}
head.add(dots);
const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.4), new THREE.MeshBasicMaterial({ map: softDisc('rgba(255,236,200,0.9)', 'rgba(255,214,150,0.28)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
halo.position.z = 0.235;
head.add(halo);
for (const sx of [-1, 1]) for (const sy of [-1, 1]) head.add(screw(sx * 1.225, sy * 0.775, 0.207));

// задняя стенка: вентиляция, шильдик, винты
for (let i = 0; i < 6; i++) {
  const slit = add(head, new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.032, 0.02), coreMat), false);
  slit.position.set(0.55, 0.5 - i * 0.1, -0.2);
}
for (const sx of [-1, 1]) for (const sy of [-1, 1]) head.add(screw(sx * 1.17, sy * 0.72, -0.207, true));
{
  const tex = labelTexture(760, 400, (ctx) => {
    ctx.fillStyle = '#17171a';
    ctx.fillRect(0, 0, 760, 400);
    ctx.fillStyle = '#e9e6dc';
    ctx.font = '500 58px "Golos Text", sans-serif';
    ctx.fillText(brandName.toUpperCase(), 36, 86);
    ctx.font = '400 34px "Golos Text", sans-serif';
    ctx.fillText('Лампа «Матрица» · В-01', 36, 150);
    ctx.fillText('336 диодов · 9 Вт · 5 В ⎓ 2 А', 36, 200);
    ctx.fillText('2000–4500 K', 36, 250);
    ctx.fillRect(36, 286, 688, 2);
    ctx.font = '400 28px "Golos Text", sans-serif';
    ctx.fillText('№ 000417 · Сделано в мастерской', 36, 340);
  });
  repaintLabel = tex.userData.repaint;
  const label = add(head, new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })), false);
  label.position.set(-0.68, -0.46, -0.2075);
  label.rotation.y = Math.PI;
}

// рама из гнутого стального прутка: дуга на полу и две стойки
const ROD = 0.045;
{
  const v = (x: number, z: number) => new THREE.Vector3(x, ROD + 0.004, z);
  const zF = 0.95, zB = -0.62, rad = 0.3;
  const path = new THREE.CurvePath<THREE.Vector3>();
  path.add(new THREE.LineCurve3(v(-ARM_X, zF), v(-ARM_X, zB + rad)));
  path.add(new THREE.QuadraticBezierCurve3(v(-ARM_X, zB + rad), v(-ARM_X, zB), v(-ARM_X + rad, zB)));
  path.add(new THREE.LineCurve3(v(-ARM_X + rad, zB), v(ARM_X - rad, zB)));
  path.add(new THREE.QuadraticBezierCurve3(v(ARM_X - rad, zB), v(ARM_X, zB), v(ARM_X, zB + rad)));
  path.add(new THREE.LineCurve3(v(ARM_X, zB + rad), v(ARM_X, zF)));
  add(spin, new THREE.Mesh(new THREE.TubeGeometry(path, 180, ROD, 14, false), steelMat));
  for (const sx of [-1, 1]) {
    const arm = add(spin, new THREE.Mesh(new THREE.CylinderGeometry(ROD, ROD, PIVOT_Y, 20), steelMat));
    arm.position.set(sx * ARM_X, PIVOT_Y / 2 + ROD, 0);
    const cap = add(spin, new THREE.Mesh(new THREE.CylinderGeometry(ROD + 0.012, ROD + 0.012, 0.16, 20), rubberMat));
    cap.rotation.x = Math.PI / 2;
    cap.position.set(sx * ARM_X, ROD + 0.004, zF - 0.02);
    const weld = add(spin, new THREE.Mesh(new THREE.CylinderGeometry(ROD + 0.014, ROD + 0.02, 0.07, 20), steelMat));
    weld.position.set(sx * ARM_X, ROD * 2 + 0.03, 0);
    const pin = add(spin, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 16), steelMat));
    pin.rotation.z = Math.PI / 2;
    pin.position.set(sx * (ARM_X - 0.06), PIVOT_Y, 0);
    const eye = add(spin, new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.1, 24), steelMat));
    eye.rotation.z = Math.PI / 2;
    eye.position.set(sx * ARM_X, PIVOT_Y, 0);
  }
  // короткий шнур питания с разъёмом: лежит за лампой и не тянется через весь стол
  const cable = new THREE.CatmullRomCurve3([new THREE.Vector3(0.7, 0.04, zB - 0.02), new THREE.Vector3(0.95, 0.032, -1.25), new THREE.Vector3(0.55, 0.032, -1.85), new THREE.Vector3(-0.35, 0.032, -1.95)]);
  add(spin, new THREE.Mesh(new THREE.TubeGeometry(cable, 90, 0.026, 10, false), rubberMat));
  const relief = add(spin, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.034, 0.2, 16), rubberMat));
  relief.rotation.x = Math.PI / 2;
  relief.position.set(0.7, 0.045, zB - 0.09);
  const plug = add(spin, new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.09, 0.14, 3, 0.03), rubberMat));
  plug.position.set(-0.5, 0.046, -1.955);
  const tip = add(spin, new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.045, 0.1, 2, 0.015), steelMat));
  tip.position.set(-0.73, 0.046, -1.955);
}

// слева барашек шарнира, справа ручка теплоты со шкалой
{
  const wing = add(spin, new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.1, 22), knurlMat));
  wing.rotation.z = Math.PI / 2;
  wing.position.set(-ARM_X - 0.1, PIVOT_Y, 0);
}
const dial = new THREE.Group();
dial.position.set(ARM_X + 0.06, PIVOT_Y, 0);
spin.add(dial);
{
  const plateTex = labelTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#17171a';
    ctx.beginPath();
    ctx.arc(256, 256, 252, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e9e6dc';
    ctx.fillStyle = '#e9e6dc';
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 - 2.4 + (4.8 * i) / 10;
      ctx.lineWidth = i % 5 === 0 ? 9 : 5;
      ctx.beginPath();
      ctx.moveTo(256 + Math.cos(a) * 196, 256 + Math.sin(a) * 196);
      ctx.lineTo(256 + Math.cos(a) * (i % 5 === 0 ? 242 : 228), 256 + Math.sin(a) * (i % 5 === 0 ? 242 : 228));
      ctx.stroke();
    }
  });
  const plate = add(dial, new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 48), [coreMat, new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.6 }), coreMat]), false);
  plate.rotation.z = -Math.PI / 2; // торец «верх» цилиндра смотрит наружу, вдоль +x
}
const knob = new THREE.Group();
knob.position.x = 0.02;
dial.add(knob);
{
  const body = add(knob, new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.185, 0.15, 40), knurlMat));
  body.rotation.z = -Math.PI / 2;
  body.position.x = 0.075;
  const cap = add(knob, new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.014, 48), accentMat), false);
  cap.rotation.z = -Math.PI / 2;
  cap.position.x = 0.156;
  const mark = add(knob, new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.024), markMat), false);
  mark.position.set(0.164, 0.07, 0);
}
const knobHit = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.4, 16));
knobHit.rotation.z = Math.PI / 2;
knobHit.position.x = 0.12;
knobHit.visible = false;
dial.add(knobHit);

// ---------- свет ----------
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
head.add(spot, spot.target);

const contact = (() => {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: LOOK.off.contact }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.004, 0.15);
  spin.add(m);
  return m.material;
})();

// ---------- шнур: верле ----------
const N = 14;
const CHAIN_LEN = 0.7; // короче, чтобы от кольца до стола оставалось больше хода, чем нужно для щелчка
const SEG = CHAIN_LEN / (N - 1);
const ANCHOR_LOCAL = new THREE.Vector3(-0.98, -H / 2 - 0.01, 0.04); // в координатах панели
const pos = new Float32Array(N * 3);
const prev = new Float32Array(N * 3);
const anchor = new THREE.Vector3();
const EXTRA = 10;
const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.026, 12, 8), beadMat, N - 1 + EXTRA);
beads.castShadow = true;
beads.frustumCulled = false;
scene.add(beads);
const pendant = new THREE.Group();
{
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.021, 14, 44), steelMat);
  ring.position.y = -0.13;
  ring.castShadow = true;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 14), steelMat);
  neck.position.y = -0.005;
  pendant.add(ring, neck);
}
scene.add(pendant);

// ---------- состояние ----------
const state = {
  on: false,
  power: 0,
  powerVel: 0,
  warmth: 0.28,
  knobAngle: 0,
  spinUser: 0, // поворот, который дал человек; к нему прибавляется поворот от скролла
  spinVel: 0,
  pitch: 0.5, // наклон панели, рад (больше = смотрит ниже)
  pitchVel: 0,
  nod: 0, // кивок панели от рывка шнура: пружинит и возвращается
  nodVel: 0,
  tilt: new THREE.Vector2(),
  tiltVel: new THREE.Vector2(),
  tiltTarget: new THREE.Vector2(),
  everPulled: false,
  fill: 0, // сколько колонок матрицы зажжено, 0..1
  digitsT: 0, // сколько секунд ещё показывать цифры теплоты
};
state.knobAngle = (state.warmth - 0.5) * 4.8;
const SPIN_BASE = -0.55; // панель смотрит влево от камеры, на текст

const headInv = new THREE.Matrix4();
const socketOut = new THREE.Vector3(0, -1, 0); // куда шнур выходит из корпуса: вниз относительно панели
function poseLamp() {
  lamp.rotation.set(state.tilt.x, 0, -state.tilt.y);
  head.rotation.x = state.pitch + state.nod;
  knob.rotation.x = -state.knobAngle;
  lamp.updateMatrixWorld(true);
  anchor.copy(ANCHOR_LOCAL).applyMatrix4(head.matrixWorld);
  headInv.copy(head.matrixWorld).invert();
  socketOut.set(0, -1, 0).transformDirection(head.matrixWorld);
}

// Шнур и кольцо не проходят сквозь панель и стол.
const RING_REACH = 0.24; // от конца шнура до нижней точки кольца
const local = new THREE.Vector3();
/** Выталкивает точку из корпуса панели наружу через ближайшую грань. Меняет вектор на месте. */
function keepOutOfPanel(v: THREE.Vector3, extra: number): void {
  local.copy(v).applyMatrix4(headInv);
  const hx = W / 2 + 0.02 + extra, hy = H / 2 + 0.005 + extra, hz = 0.215 + 0.02 + extra;
  const px = hx - Math.abs(local.x), py = hy - Math.abs(local.y), pz = hz - Math.abs(local.z);
  if (px <= 0 || py <= 0 || pz <= 0) return;
  if (pz <= px && pz <= py) local.z = (local.z < 0 ? -1 : 1) * hz;
  else if (py <= px) local.y = (local.y > 0 ? 1 : -1) * hy;
  else local.x = (local.x < 0 ? -1 : 1) * hx;
  v.copy(local).applyMatrix4(head.matrixWorld);
}
spin.rotation.y = SPIN_BASE;
poseLamp();
for (let i = 0; i < N; i++) {
  pos[i * 3] = prev[i * 3] = anchor.x;
  pos[i * 3 + 1] = prev[i * 3 + 1] = anchor.y - i * SEG;
  pos[i * 3 + 2] = prev[i * 3 + 2] = anchor.z;
}

type DragKind = 'cord' | 'knob' | 'head';
let drag: { kind: DragKind; id: number; x: number; y: number; t: number; x0: number; y0: number; t0: number } | null = null;
const dragTarget = new THREE.Vector3();
const dragPlane = new THREE.Plane();
let armed = true;
const TRAVEL = 0.4; // ход шнура до щелчка
let grab = N - 1;
const grabOffset = new THREE.Vector3();
let travel = 0;
const travelDir = new THREE.Vector3(0, -1, 0);
let auto = -1;
let autoFired = false;

const K_STOPS: Array<[number, THREE.Color]> = [
  [0, new THREE.Color('#ff8a12')],
  [0.28, new THREE.Color('#ffb46a')],
  [1, new THREE.Color('#ffe9d2')],
];
const kelvinColor = new THREE.Color();
function updateKelvin() {
  const w = state.warmth;
  const [a, b] = w < K_STOPS[1][0] ? [K_STOPS[0], K_STOPS[1]] : [K_STOPS[1], K_STOPS[2]];
  kelvinColor.copy(a[1]).lerp(b[1], (w - a[0]) / (b[0] - a[0]));
}
updateKelvin();
const kelvinNow = () => Math.round((2000 + state.warmth * 2500) / 50) * 50;

const $state = document.querySelector<HTMLElement>('#state')!;
const $kelvin = document.querySelector<HTMLElement>('#kelvin')!;
function setOn(on: boolean) {
  state.on = on;
  document.body.dataset.light = on ? 'on' : 'off';
  $state.textContent = on ? 'включена' : 'выключена';
}
function toggle() {
  setOn(!state.on);
  state.everPulled = true;
  wake();
}
document.querySelector('#pull')!.addEventListener('click', toggle);

const $brand = document.querySelector<HTMLButtonElement>('#brand')!;
const $brandHint = document.querySelector<HTMLElement>('#brandhint')!;
function showBrand() {
  $brand.textContent = brandName;
  $brandHint.textContent = '';
  document.title = `Прототип: ${brandName}, выпуск № 07`;
  repaintLabel();
}
$brand.addEventListener('click', () => {
  brandName = NAMES[(NAMES.indexOf(brandName) + 1) % NAMES.length];
  try { localStorage.setItem('vs-name', brandName); } catch { /* не страшно: выбор просто не запомнится */ }
  showBrand();
});
showBrand();

// ---------- шрифт заголовков: переключается кнопкой, выбор запоминается ----------
type Face = { name: string; family: string; weight: number; track: string; settings?: string; lh?: string; text?: string };
const FACES: Face[] = [
  { name: 'Sofia Sans 1000', family: '"Sofia Sans"', weight: 1000, track: '-0.05em' }, // выбран владельцем 2026-11-19
];
let face = 0;
try { face = Math.min(Number(localStorage.getItem('vs-face') ?? 0) || 0, FACES.length - 1); } catch { /* остаётся первый шрифт */ }
const $fontBtn = document.querySelector<HTMLButtonElement>('#fontbtn')!;
/** Подгоняет кегль каждой крупной надписи так, чтобы она занимала свою долю ширины окна. */
function fitAll() {
  for (const el of document.querySelectorAll<HTMLElement>('.fit')) {
    const share = Number(el.dataset.fit ?? 0.9);
    el.style.fontSize = '200px';
    const w = el.getBoundingClientRect().width || 1;
    el.style.fontSize = `${((200 * window.innerWidth * share) / w).toFixed(1)}px`;
  }
}
async function showFace() {
  const f = FACES[face];
  const root = document.documentElement.style;
  root.setProperty('--display', f.family);
  root.setProperty('--display-weight', String(f.weight));
  root.setProperty('--display-track', f.track);
  root.setProperty('--display-settings', f.settings ?? 'normal');
  root.setProperty('--display-lh', f.lh ?? '.76');
  root.setProperty('--text', f.text ?? f.family);
  $fontBtn.hidden = FACES.length < 2;
  $fontBtn.textContent = `шрифт ${face + 1} из ${FACES.length}: ${f.name}`;
  try { await document.fonts.load(`${f.weight} 200px ${f.family}`, 'Лума 0123456789'); } catch { /* подгонка пройдёт по запасному шрифту */ }
  fitAll();
}
$fontBtn.addEventListener('click', () => {
  face = (face + 1) % FACES.length;
  try { localStorage.setItem('vs-face', String(face)); } catch { /* выбор не запомнится */ }
  void showFace();
});
window.addEventListener('resize', fitAll);
void showFace();

const $colorName = document.querySelector<HTMLElement>('#colorname')!;
const swatches = [...document.querySelectorAll<HTMLButtonElement>('#swatches button')];
for (const btn of swatches) {
  btn.addEventListener('click', () => {
    bodyColor.set(btn.dataset.color!);
    shellMat.color.copy(bodyColor);
    wake();
    for (const other of swatches) other.setAttribute('aria-pressed', String(other === btn));
    $colorName.textContent = btn.dataset.name!;
  });
}

// ---------- матрица точек ----------
const FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};
const mask = new Uint8Array(COLS * ROWS);
function setDigits(text: string) {
  mask.fill(0);
  const width = text.length * 5 + (text.length - 1);
  const c0 = Math.floor((COLS - width) / 2);
  const r0 = Math.floor((ROWS - 7) / 2);
  [...text].forEach((ch, n) => {
    const glyph = FONT[ch];
    if (!glyph) return;
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (glyph[r][c] === '1') mask[(r0 + r) * COLS + c0 + n * 6 + c] = 1;
  });
}
setDigits(String(kelvinNow()));
const dotColor = new THREE.Color();
const dotOff = new THREE.Color(0.035, 0.035, 0.04);
let level = 0; // средняя яркость матрицы 0..1: столько света даёт лампа
function drawMatrix(dt: number) {
  const target = state.on ? 1 : 0;
  state.fill += THREE.MathUtils.clamp(target - state.fill, -dt / 0.3, dt / 0.42);
  state.digitsT = Math.max(0, state.digitsT - dt);
  const digits = state.digitsT > 0 && state.fill > 0.6;
  const fade = Math.min(state.digitsT / 0.35, 1); // цифры плавно растворяются обратно в ровный свет
  let sum = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      let b = THREE.MathUtils.clamp((state.fill * (COLS + 5) - c) / 5, 0, 1); // включение волной слева направо
      if (digits && !mask[i]) b *= 1 - 0.9 * fade;
      sum += b;
      dotColor.copy(dotOff).lerp(kelvinColor, Math.min(b * 4, 1)).multiplyScalar(1 + b * (LOOK.dots - 1));
      dots.setColorAt(i, dotColor);
    }
  }
  dots.instanceColor!.needsUpdate = true;
  level = sum / (COLS * ROWS);
}

// ---------- указатель ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const headTargets = [frontShell, backShell, bezel];
function setRay(x: number, y: number) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
const tmpV = new THREE.Vector3();
const proj = new THREE.Vector3();
/** Ближайшее к курсору звено шнура в экранных пикселях, либо -1. Кольцо на конце считается последним звеном. */
function cordAt(x: number, y: number, radius: number): number {
  const w = window.innerWidth, h = window.innerHeight;
  pendant.localToWorld(proj.set(0, -0.13, 0));
  const ppu = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.distanceTo(proj));
  proj.project(camera);
  const bx = (proj.x * 0.5 + 0.5) * w - x, by = (-proj.y * 0.5 + 0.5) * h - y;
  const ringR = 0.13 * ppu + radius * 0.6;
  if (proj.z < 1 && bx * bx + by * by < ringR * ringR) return N - 1;
  let best = -1, bestD = radius * radius;
  for (let i = 2; i < N; i++) {
    proj.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).project(camera);
    if (proj.z > 1) continue;
    const dx = (proj.x * 0.5 + 0.5) * w - x, dy = (-proj.y * 0.5 + 0.5) * h - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
let picked = -1;
function pick(x: number, y: number, radius = 14): DragKind | null {
  picked = cordAt(x, y, radius);
  if (picked >= 0) return 'cord';
  setRay(x, y);
  if (raycaster.intersectObject(knobHit).length) return 'knob';
  if (raycaster.intersectObjects(headTargets).length) return 'head';
  return null;
}
function updateDragTarget(x: number, y: number) {
  setRay(x, y);
  if (raycaster.ray.intersectPlane(dragPlane, tmpV)) dragTarget.copy(tmpV).add(grabOffset);
}

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || (e.target as HTMLElement).closest('a, button')) return;
  const kind = pick(e.clientX, e.clientY, e.pointerType === 'mouse' ? 14 : 26);
  if (!kind) return;
  e.preventDefault();
  const now = performance.now();
  drag = { kind, id: e.pointerId, x: e.clientX, y: e.clientY, t: now, x0: e.clientX, y0: e.clientY, t0: now };
  wake();
  if (kind === 'cord') {
    grab = picked;
    auto = -1;
    const g = grab * 3;
    const held = new THREE.Vector3(pos[g], pos[g + 1], pos[g + 2]);
    camera.getWorldDirection(tmpV);
    dragPlane.setFromNormalAndCoplanarPoint(tmpV.clone(), held);
    setRay(e.clientX, e.clientY);
    grabOffset.set(0, 0, 0);
    if (raycaster.ray.intersectPlane(dragPlane, tmpV)) grabOffset.copy(held).sub(tmpV);
    dragTarget.copy(held);
  }
  if (kind === 'head') { state.spinVel = 0; state.pitchVel = 0; }
  document.body.style.cursor = 'grabbing';
});
window.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (e.pointerType === 'mouse') document.body.style.cursor = pick(e.clientX, e.clientY) ? 'grab' : '';
    return;
  }
  if (e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  const now = performance.now();
  const dt = Math.max((now - drag.t) / 1000, 1 / 240);
  if (drag.kind === 'cord') updateDragTarget(e.clientX, e.clientY);
  if (drag.kind === 'head') {
    // вбок: вся лампа поворачивается; вверх-вниз: панель качается в раме
    state.spinUser += dx * 0.006;
    state.spinVel = THREE.MathUtils.lerp(state.spinVel, (dx * 0.006) / dt, 0.5);
    const before = state.pitch;
    state.pitch = THREE.MathUtils.clamp(state.pitch + dy * 0.006, -0.45, 1.3);
    state.pitchVel = THREE.MathUtils.lerp(state.pitchVel, (state.pitch - before) / dt, 0.5);
  }
  if (drag.kind === 'knob') {
    state.knobAngle = THREE.MathUtils.clamp(state.knobAngle + (dx - dy) * 0.014, -2.4, 2.4);
    state.warmth = (state.knobAngle + 2.4) / 4.8;
    updateKelvin();
    const k = String(kelvinNow());
    if ($kelvin.textContent !== k) {
      $kelvin.textContent = k;
      setDigits(k);
    }
    state.digitsT = 1.5;
  }
  drag.x = e.clientX;
  drag.y = e.clientY;
  drag.t = now;
});
function endDrag(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.kind === 'head' && performance.now() - drag.t > 80) { state.spinVel = 0; state.pitchVel = 0; }
  const still = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6 && performance.now() - drag.t0 < 400;
  if (drag.kind === 'cord' && still && e.type === 'pointerup') {
    auto = 0;
    autoFired = false;
    travelDir.set(0, -1, 0);
  }
  drag = null;
  armed = true;
  state.tiltTarget.set(0, 0);
  document.body.style.cursor = '';
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  if (t && !(e.target as HTMLElement).closest('a, button') && pick(t.clientX, t.clientY, 26)) e.preventDefault();
}, { passive: false });

// ---------- физика шнура ----------
const GRAVITY = 98;
const STEP = 1 / 120;
function stepChain() {
  const dragging = drag?.kind === 'cord';
  for (let i = 1; i < N; i++) {
    const k = i * 3;
    for (let a = 0; a < 3; a++) {
      const v = (pos[k + a] - prev[k + a]) * 0.992;
      prev[k + a] = pos[k + a];
      pos[k + a] += v;
    }
    pos[k + 1] -= GRAVITY * STEP * STEP;
  }
  let pin = -1;
  if (dragging) {
    pin = grab;
    const rest = grab * SEG;
    const byRing = grab === N - 1;
    // куда рука может увести звено: не ниже стола и не внутрь панели
    held.copy(dragTarget);
    held.y = Math.max(held.y, byRing ? 0.03 + RING_REACH : 0.05);
    keepOutOfPanel(held, byRing ? 0.11 : 0.03);
    tmpV.copy(held).sub(anchor);
    const len = tmpV.length() || 1e-6;
    let excess = Math.max(0, len - rest);
    // шнур вытягивается из корпуса только когда тянут от панели, а не вверх и не вбок вдоль неё
    const outward = excess > 0 && tmpV.dot(socketOut) / len > 0.25;
    if (excess > 0 && !outward) {
      tmpV.multiplyScalar(rest / len);
      excess = 0;
    }
    if (excess > 0) {
      const over = Math.max(0, excess - TRAVEL);
      travel = Math.min(excess, TRAVEL) + 0.1 * (1 - Math.exp(-over / 0.1));
      travelDir.copy(tmpV).divideScalar(len);
      tmpV.copy(travelDir).multiplyScalar(rest + travel);
      // и после упора кольцо не уходит под стол
      const floorY = (byRing ? 0.03 + RING_REACH : 0.05) - anchor.y;
      if (tmpV.y < floorY) tmpV.y = floorY;
      state.tiltTarget.set(travelDir.z, travelDir.x).multiplyScalar(travel * 0.12);
    } else {
      travel = 0;
      state.tiltTarget.set(0, 0);
    }
    const g = grab * 3;
    pos[g] = anchor.x + tmpV.x;
    pos[g + 1] = anchor.y + tmpV.y;
    pos[g + 2] = anchor.z + tmpV.z;
    if (armed && excess >= TRAVEL) {
      armed = false;
      toggle();
      state.tiltVel.addScaledVector(state.tiltTarget, 9);
      state.nodVel += 1.6; // панель клюёт носом от рывка и возвращается
    } else if (!armed && excess < TRAVEL * 0.35) armed = true;
  }
  const x0 = anchor.x + travelDir.x * travel, y0 = anchor.y + travelDir.y * travel, z0 = anchor.z + travelDir.z * travel;
  for (let it = 0; it < 14; it++) {
    pos[0] = x0; pos[1] = y0; pos[2] = z0;
    for (let i = 0; i < N - 1; i++) {
      const a = i * 3, b = a + 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.hypot(dx, dy, dz) || 1e-6;
      const diff = (d - SEG) / d;
      const pinA = i === 0 || i === pin;
      const pinB = i + 1 === pin;
      const wa = pinA ? 0 : pinB ? 1 : 0.5;
      const wb = pinB ? 0 : pinA ? 1 : 0.5;
      pos[a] += dx * diff * wa; pos[a + 1] += dy * diff * wa; pos[a + 2] += dz * diff * wa;
      pos[b] -= dx * diff * wb; pos[b + 1] -= dy * diff * wb; pos[b + 2] -= dz * diff * wb;
    }
    for (let i = 1; i < N; i++) {
      if (i === pin) continue;
      const k = i * 3;
      const last = i === N - 1;
      const minY = last ? 0.03 + RING_REACH : 0.03;
      if (pos[k + 1] < minY) pos[k + 1] = minY;
      held2.set(pos[k], pos[k + 1], pos[k + 2]);
      keepOutOfPanel(held2, last ? 0.11 : 0.03);
      pos[k] = held2.x; pos[k + 1] = held2.y; pos[k + 2] = held2.z;
    }
  }
}

const held = new THREE.Vector3();
const held2 = new THREE.Vector3();
const mtx = new THREE.Matrix4();
const up = new THREE.Vector3(0, 1, 0);
const hang = new THREE.Vector3(0, 1, 0); // сглаженное направление, вдоль которого висит кольцо
const quat = new THREE.Quaternion();
function drawChain() {
  for (let i = 0; i < N - 1; i++) {
    mtx.makeTranslation(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    beads.setMatrixAt(i, mtx);
  }
  for (let j = 1; j <= EXTRA; j++) {
    const d = Math.max(travel - j * SEG, 0);
    mtx.makeTranslation(anchor.x + travelDir.x * d, anchor.y + travelDir.y * d, anchor.z + travelDir.z * d);
    beads.setMatrixAt(N - 2 + j, mtx);
  }
  beads.instanceMatrix.needsUpdate = true;
  const e = (N - 1) * 3, p = e - 3;
  pendant.position.set(pos[e], pos[e + 1], pos[e + 2]);
  const inHand = drag?.kind === 'cord' && grab === N - 1;
  if (inHand) tmpV.set(0, 1, 0);
  else tmpV.set(pos[p] - pos[e], pos[p + 1] - pos[e + 1], pos[p + 2] - pos[e + 2]).normalize();
  hang.lerp(tmpV, inHand ? 0.3 : 0.45).normalize();
  pendant.quaternion.copy(quat.setFromUnitVectors(up, hang));
}

// ---------- камера по скроллу ----------
// Кадр задаётся так: откуда смотрим (pos), на что (at) и где эта точка стоит в кадре (sx, sy: -1..1 от центра).
// Место в кадре даёт сдвиг проекции, поэтому лампа не уезжает за край при любой ширине окна.
type Shot = { pos: THREE.Vector3; at: THREE.Vector3; sx: number; sy: number };
const shot = (px: number, py: number, pz: number, ax: number, ay: number, az: number, sx: number, sy: number): Shot => ({ pos: new THREE.Vector3(px, py, pz), at: new THREE.Vector3(ax, ay, az), sx, sy });
const SHOTS_WIDE: Shot[] = [
  shot(0.3, 2.6, 14.6, 0, 1.6, 0, 0.46, 0.02), // первый экран: лампа справа, светит на текст
  shot(-4.2, 1.7, 7.6, 0, 2.15, 0, -0.46, 0), // панель крупно, лампа слева
  shot(5.8, 2.95, 5.0, 1.0, 2.25, 0.6, 0.36, 0), // ручка теплоты сбоку
  shot(2.1, 3.0, 12.2, 0, 1.6, 0, 0.46, 0.02), // лампа повёрнута тыльной стороной
];
const SHOTS_TALL: Shot[] = [
  shot(0.3, 3.4, 21, 0, 1.6, 0, 0, -0.3), // лампа в нижней половине, заголовок над ней
  shot(-3.4, 1.8, 10, 0, 2.2, 0, 0, 0.42), // панель в верхней половине, текст под ней
  shot(5.4, 3.0, 6.4, 1.0, 2.25, 0.6, 0, 0.44), // ручка в верхней половине
  shot(1.8, 3.4, 19, 0, 1.6, 0, 0, 0.48), // тыльная сторона вверху, таблица под ней
];
let wideness = 1; // 0 = узкое окно (предмет по центру), 1 = широкое (предмет сбоку от текста)
let scrollP = 0;
let camP = 0;
const baseProj = new THREE.Matrix4();
const shotA: Shot = shot(0, 0, 0, 0, 0, 0, 0, 0);
const shotB: Shot = shot(0, 0, 0, 0, 0, 0, 0, 0);
function fitShot(i: number, out: Shot): Shot {
  const a = SHOTS_TALL[i], b = SHOTS_WIDE[i];
  out.pos.lerpVectors(a.pos, b.pos, wideness);
  out.at.lerpVectors(a.at, b.at, wideness);
  const back = THREE.MathUtils.lerp(1, THREE.MathUtils.clamp(1.55 / camera.aspect, 1, 1.45), wideness);
  out.pos.sub(out.at).multiplyScalar(back).add(out.at);
  out.sx = THREE.MathUtils.lerp(a.sx, b.sx, wideness);
  out.sy = THREE.MathUtils.lerp(a.sy, b.sy, wideness);
  return out;
}
function readScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  scrollP = max > 0 ? (window.scrollY / max) * (SHOTS_WIDE.length - 1) : 0;
  wake();
}
window.addEventListener('scroll', readScroll, { passive: true });
const camAt = new THREE.Vector3();
function placeCamera(p: number) {
  const i = Math.min(Math.floor(p), SHOTS_WIDE.length - 2);
  const t = THREE.MathUtils.smootherstep(p - i, 0, 1);
  const a = fitShot(i, shotA), b = fitShot(i + 1, shotB);
  camera.position.lerpVectors(a.pos, b.pos, t);
  camera.lookAt(camAt.lerpVectors(a.at, b.at, t));
  camera.projectionMatrix.copy(baseProj);
  camera.projectionMatrix.elements[8] = -THREE.MathUtils.lerp(a.sx, b.sx, t);
  camera.projectionMatrix.elements[9] = -THREE.MathUtils.lerp(a.sy, b.sy, t);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatioFor(w, h));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = THREE.MathUtils.lerp(30, 28, THREE.MathUtils.smoothstep(w / h, 0.62, 1.3));
  camera.updateProjectionMatrix();
  baseProj.copy(camera.projectionMatrix);
  wideness = THREE.MathUtils.smoothstep(w / h, 0.62, 1.3);
  readScroll();
  wake();
}
window.addEventListener('resize', resize);
resize();
camP = scrollP;

// ---------- кадр ----------
const cOff = { sky: new THREE.Color(LOOK.off.sky), ground: new THREE.Color(LOOK.off.ground), bg: new THREE.Color(LOOK.off.bg) };
const cOn = { ground: new THREE.Color(LOOK.on.ground), bg: new THREE.Color(LOOK.on.bg) };
const cTmp = new THREE.Color();
const white = new THREE.Color(0xffffff);
let lastLit = -1;
const beam = new THREE.Vector3();
const beamFrom = new THREE.Vector3();
const $pool = document.querySelector<HTMLElement>('#poollight')!;
const pc = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), pu = new THREE.Vector3(), pv = new THREE.Vector3();
const sc = new THREE.Vector2(), sa = new THREE.Vector2(), sb = new THREE.Vector2();
const projTmp = new THREE.Vector3();
/** Точка сцены в пикселях окна. */
function toScreen(v: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
  projTmp.copy(v).project(camera);
  return out.set((projTmp.x * 0.5 + 0.5) * window.innerWidth, (-projTmp.y * 0.5 + 0.5) * window.innerHeight);
}
function applyLight() {
  const q = THREE.MathUtils.clamp(state.power, 0, 1);
  cTmp.copy(kelvinColor).lerp(white, 0.8);
  hemi.color.copy(cOff.sky).lerp(cTmp, q);
  hemi.groundColor.copy(cOff.ground).lerp(cOn.ground, q);
  hemi.intensity = THREE.MathUtils.lerp(LOOK.off.hemi, LOOK.on.hemi, q);
  windowLight.intensity = THREE.MathUtils.lerp(LOOK.off.window, LOOK.on.window, q);
  scene.environmentIntensity = THREE.MathUtils.lerp(LOOK.off.env, LOOK.on.env, q);
  const lit = Math.round(q * 100);
  if (lit !== lastLit) { lastLit = lit; document.documentElement.style.setProperty('--lit', lit + '%'); }
  contact.opacity = THREE.MathUtils.lerp(LOOK.off.contact, LOOK.on.contact, q);
  floorMat.opacity = THREE.MathUtils.lerp(0.42, 0.26, q);
  halo.material.opacity = level * 0.42;
  halo.material.color.copy(kelvinColor).lerp(white, 0.4);
  // тень от окна слабеет, когда горит лампа: главным источником становится она
  windowLight.shadow.intensity = THREE.MathUtils.lerp(1, 0.22, q);
  // Куда панель светит на стол: луч из её центра вдоль нормали. Пятно рисует HTML-слой в режиме overlay:
  // свет должен высветлять цвет фона и не делать чёрные буквы серыми, а холст так смешиваться со страницей не умеет.
  head.getWorldDirection(beam);
  head.getWorldPosition(beamFrom);
  let poolOpacity = 0;
  if (beam.y < -0.08 && level > 0.01) {
    const t = Math.min(-beamFrom.y / beam.y, 14);
    pc.set(beamFrom.x + beam.x * t, 0, beamFrom.z + beam.z * t);
    const across = 1.7 + t * 0.62;
    const along = across * Math.min(1 / Math.max(-beam.y, 0.22), 2.4); // чем положе луч, тем длиннее пятно
    pu.set(beam.x, 0, beam.z).normalize();
    pv.set(-pu.z, 0, pu.x);
    toScreen(pc, sc);
    toScreen(pa.copy(pc).addScaledVector(pu, along), sa);
    toScreen(pb.copy(pc).addScaledVector(pv, across), sb);
    $pool.style.transform = `matrix(${((sa.x - sc.x) / 100).toFixed(4)}, ${((sa.y - sc.y) / 100).toFixed(4)}, ${((sb.x - sc.x) / 100).toFixed(4)}, ${((sb.y - sc.y) / 100).toFixed(4)}, ${sc.x.toFixed(1)}, ${sc.y.toFixed(1)})`;
    poolOpacity = level * THREE.MathUtils.clamp(1.35 - t / 9, 0.3, 1);
  } else toScreen(pc.copy(beamFrom).setY(0), sc);
  $pool.style.opacity = poolOpacity.toFixed(3);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--lit-n', q.toFixed(3));
  rootStyle.setProperty('--lx', `${((sc.x / window.innerWidth) * 100).toFixed(1)}%`);
  rootStyle.setProperty('--ly', `${((sc.y / window.innerHeight) * 100).toFixed(1)}%`);
  spot.color.copy(kelvinColor).lerp(white, 0.25);
  spot.intensity = LOOK.spot * level * (0.85 + state.warmth * 0.3);
}

const timer = new THREE.Timer();
timer.connect(document);
let acc = 0;
let idleT = 0;
let nudges = 0;
let lastSig = 0;
function frame() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 1 / 20);

  // пока лампу не включали, шнур раз в несколько секунд сам покачивается и зовёт потянуть
  // три раза, с паузой в шесть секунд, и хватит: иначе подсказка не даёт странице уснуть
  if (!state.everPulled && !drag && nudges < 3) {
    idleT += dt;
    if (idleT > 6) {
      idleT = 0;
      nudges++;
      for (let i = N - 5; i < N; i++) prev[i * 3] -= 0.011;
      wake();
    }
  }
  if (drag || auto >= 0) wake();
  if (awake <= 0) return; // всё стоит: ни физики, ни рендера

  const target = state.on ? 1 : 0;
  state.powerVel += ((target - state.power) * 150 - state.powerVel * 19) * dt;
  state.power += state.powerVel * dt;

  // вращение: инерция от руки плюс поворот от скролла (в конце лампа показывает спину)
  if (drag?.kind !== 'head') {
    state.spinUser += state.spinVel * dt;
    state.spinVel *= Math.exp(-2.1 * dt);
    // у остановок с ручкой и со спиной лампа сама возвращается в поставленную позу
    const near = Math.max(1 - Math.min(Math.abs(camP - 2) / 0.6, 1), 1 - Math.min(Math.abs(camP - 3) / 0.6, 1));
    if (near > 0 && Math.abs(state.spinVel) < 1.2) {
      const turn = Math.PI * 2;
      const home = Math.round(state.spinUser / turn) * turn;
      state.spinUser += (home - state.spinUser) * (1 - Math.exp(-5 * near * dt));
    }
    // шарнир тугой: панель доезжает чуть-чуть и встаёт
    state.pitch = THREE.MathUtils.clamp(state.pitch + state.pitchVel * dt, -0.45, 1.3);
    state.pitchVel *= Math.exp(-9 * dt);
  }
  const back = THREE.MathUtils.smootherstep(camP, 2.35, 3) * 2.75;
  spin.rotation.y = SPIN_BASE + state.spinUser + back;

  state.tiltVel.x += ((state.tiltTarget.x - state.tilt.x) * 150 - state.tiltVel.x * 8) * dt;
  state.tiltVel.y += ((state.tiltTarget.y - state.tilt.y) * 150 - state.tiltVel.y * 8) * dt;
  state.tilt.addScaledVector(state.tiltVel, dt);
  state.nodVel += (-state.nod * 140 - state.nodVel * 9) * dt;
  state.nod += state.nodVel * dt;
  poseLamp();

  if (auto >= 0) {
    auto += dt;
    const ph = auto / 0.28;
    travel = TRAVEL * Math.sin(Math.PI * Math.min(ph, 1));
    if (ph >= 0.5 && !autoFired) {
      autoFired = true;
      toggle();
      state.nodVel += 1.6;
    }
    if (ph >= 1) { auto = -1; travel = 0; }
  } else if (drag?.kind !== 'cord') travel *= Math.exp(-26 * dt);
  acc = Math.min(acc + dt, 0.1);
  while (acc >= STEP) {
    stepChain();
    acc -= STEP;
  }
  drawChain();
  drawMatrix(dt);

  camP += (scrollP - camP) * (1 - Math.exp(-5.5 * dt));
  placeCamera(camP);
  applyLight();
  renderer.render(scene, camera);

  // подпись состояния: если она изменилась с прошлого кадра, что-то ещё движется
  const e = (N - 1) * 3;
  const sig = camP * 31 + spin.rotation.y * 17 + (state.pitch + state.nod) * 13 + state.tilt.x * 7 + state.tilt.y * 5 + travel * 3
    + state.power * 11 + state.fill * 19 + state.digitsT + state.knobAngle * 2 + pos[e] * 23 + pos[e + 1] * 29 + pos[e + 2] * 37 + pos[e - 18] * 41;
  if (Math.abs(sig - lastSig) > 2e-4) awake = 24;
  else awake--;
  lastSig = sig;
}
renderer.setAnimationLoop(frame);

// Крючки для скриншотов и автоматической проверки.
Object.assign(window, {
  __spike: {
    setOn(on: boolean) { setOn(on); state.everPulled = true; state.power = on ? 1 : 0; state.powerVel = 0; state.fill = on ? 1 : 0; wake(); },
    wake,
    get awake() { return awake; },
    look: LOOK,
    state,
    dev: { renderer, scene, camera, windowLight, spot, frame },
    screen(what: 'pendant' | 'knob' | 'head') {
      const v = new THREE.Vector3();
      if (what === 'pendant') pendant.localToWorld(v.set(0, -0.13, 0));
      else if (what === 'knob') knob.localToWorld(v.set(0.16, 0, 0));
      else head.localToWorld(v.set(0.3, 0.1, 0.22));
      v.project(camera);
      return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
    },
    // диагностика кольца: где его центр на экране и в мире, не ушло ли под стол и не внутри ли панели
    ring() {
      const c = pendant.localToWorld(new THREE.Vector3(0, -0.13, 0));
      const inHead = head.worldToLocal(c.clone());
      const w = c.clone().project(camera);
      const lo = Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => pendant.localToWorld(new THREE.Vector3(Math.cos(k * Math.PI / 4) * 0.126, -0.13 + Math.sin(k * Math.PI / 4) * 0.126, 0)).y));
      return { sx: Math.round((w.x * 0.5 + 0.5) * window.innerWidth), sy: Math.round((-w.y * 0.5 + 0.5) * window.innerHeight), y: +c.y.toFixed(3), lowest: +lo.toFixed(3), insidePanel: Math.abs(inHead.x) < 1.3 && Math.abs(inHead.y) < 0.85 && Math.abs(inHead.z) < 0.21 };
    },
    chain() {
      const pt = (i: number) => { const v = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); const w = v.clone().project(camera); return { y: +v.y.toFixed(3), sx: Math.round((w.x * 0.5 + 0.5) * window.innerWidth), sy: Math.round((-w.y * 0.5 + 0.5) * window.innerHeight) }; };
      return { end: pt(N - 1), mid: pt(Math.floor(N / 2)), top: pt(3), endY: +pos[(N - 1) * 3 + 1].toFixed(3), drag: drag ? drag.kind : null, grab, travel: +travel.toFixed(3) };
    },
  },
});

// Геометрия и материалы лампы (порт спайка). Единицы сцены: 1 = 10 см, лампа стоит в начале координат, стол в y = 0.
// Без поведения: позой, цветом точек и свечением занимается код выше. Работает в Node без DOM: текстуры на canvas
// создаются, только когда есть document, иначе материал остаётся без карты.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FONT_FAMILY as FONT } from '../page/contract';
import { COLS, ROWS } from './matrix';

export interface LampModel {
  root: THREE.Group; spin: THREE.Group; head: THREE.Group; knob: THREE.Group;
  dots: THREE.InstancedMesh; halo: THREE.Mesh;
  beads: THREE.InstancedMesh; ring: THREE.Group; // шнур живёт в координатах сцены, в root не входит
  shell: THREE.MeshStandardMaterial; // цвет корпуса
  headTargets: THREE.Mesh[]; knobTarget: THREE.Mesh;
  anchorLocal: THREE.Vector3; // выход шнура в координатах head
  halfSize: { x: number; y: number; z: number }; // половины габаритов панели: по ним шнур выталкивается из корпуса
  center: THREE.Vector3; radius: number; // шар, в который вписана лампа без шнура
  setBrand(name: string): void; // перерисовать шильдик; без document ничего не делает
}

const HAS_DOM = typeof document !== 'undefined';
const DEFAULT_BRAND = 'Верст';

function canvasOf(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  // Без lang Sofia Sans подставляет болгарские формы букв («Л» в слове «ЛУМА» и в шильдике).
  c.lang = 'ru';
  const ctx = c.getContext('2d')!;
  if ('lang' in ctx) (ctx as CanvasRenderingContext2D & { lang: string }).lang = 'ru';
  return { c, ctx };
}

/** Мягкое круглое пятно для ореола панели. */
function softDisc(inner: string, outer: string): THREE.CanvasTexture | undefined {
  if (!HAS_DOM) return undefined;
  const size = 256;
  const { c, ctx } = canvasOf(size, size);
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

/** Мелкое зерно литого пластика: без него корпус выглядит как гладкая заготовка. */
function grainTexture(): THREE.CanvasTexture | undefined {
  if (!HAS_DOM) return undefined;
  const size = 256;
  const { c, ctx } = canvasOf(size, size);
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

/** Текстура, нарисованная функцией draw; repaint перерисовывает её (например, после загрузки шрифта). */
function paintedTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): { tex: THREE.CanvasTexture; repaint: () => void } | undefined {
  if (!HAS_DOM) return undefined;
  const { c, ctx } = canvasOf(w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const repaint = () => {
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
    tex.needsUpdate = true;
  };
  repaint();
  document.fonts?.load(`1000 40px ${FONT}`).then(repaint, () => {});
  return { tex, repaint };
}

export function buildLamp(): LampModel {
  const grain = grainTexture();

  // ---------- материалы ----------
  const shellMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c2bfb6'), roughness: 0.66, roughnessMap: grain ?? null, bumpMap: grain ?? null, bumpScale: 0.5 });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.7 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x060607, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0xd2d3d6, metalness: 1, roughness: 0.26 });
  const beadMat = new THREE.MeshStandardMaterial({ color: 0xcfd0d4, metalness: 1, roughness: 0.3 });
  const knurlMat = new THREE.MeshStandardMaterial({ color: 0xc2c3c7, metalness: 1, roughness: 0.4, flatShading: true });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x121213, roughness: 0.92 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xf0541c, roughness: 0.48 });
  const markMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.6 });

  // ---------- каркас групп ----------
  const PIVOT_Y = 2.3; // высота оси, на которой качается панель
  const ARM_X = 1.42;
  const root = new THREE.Group();
  const spin = new THREE.Group(); // вращение вокруг вертикали
  const head = new THREE.Group(); // панель: качается на оси рамы
  root.add(spin);
  spin.add(head);
  head.position.y = PIVOT_Y;
  spin.rotation.y = -0.55;
  head.rotation.x = 0.5;

  const add = <T extends THREE.Object3D>(parent: THREE.Object3D, obj: T, cast = true): T => {
    if ((obj as unknown as THREE.Mesh).isMesh) {
      obj.castShadow = cast;
      obj.receiveShadow = true;
    }
    parent.add(obj);
    return obj;
  };

  /** Винт с крестовым шлицем, головкой к +z. */
  const screw = (x: number, y: number, z: number, faceBack = false): THREE.Group => {
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
  };

  // ---------- корпус из двух половин со швом ----------
  const W = 2.6, H = 1.7;
  const frontShell = add(head, new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.2, 5, 0.085), shellMat));
  frontShell.position.z = 0.106;
  const backShell = add(head, new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.2, 5, 0.085), shellMat));
  backShell.position.z = -0.106;
  add(head, new THREE.Mesh(new THREE.BoxGeometry(W - 0.05, H - 0.05, 0.1), coreMat), false);

  // тёмное стекло и матрица точек за ним
  const bezel = add(head, new THREE.Mesh(new RoundedBoxGeometry(2.3, 1.4, 0.02, 3, 0.04), glassMat), false);
  bezel.position.z = 0.2;
  const PITCH = 0.09;
  const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.03, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }), COLS * ROWS);
  dots.frustumCulled = false;
  {
    const m = new THREE.Matrix4();
    const off = new THREE.Color(0.03, 0.03, 0.03);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        m.makeTranslation((c - (COLS - 1) / 2) * PITCH, ((ROWS - 1) / 2 - r) * PITCH, 0.2115);
        dots.setMatrixAt(r * COLS + c, m);
        dots.setColorAt(r * COLS + c, off);
      }
    }
  }
  head.add(dots);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 2.4),
    new THREE.MeshBasicMaterial({ map: softDisc('rgba(255,236,200,0.9)', 'rgba(255,214,150,0.28)') ?? null, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }),
  );
  halo.position.z = 0.235;
  head.add(halo);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) head.add(screw(sx * 1.225, sy * 0.775, 0.207));

  // ---------- задняя стенка: вентиляция, шильдик, винты ----------
  for (let i = 0; i < 6; i++) {
    const slit = add(head, new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.032, 0.02), coreMat), false);
    slit.position.set(0.55, 0.5 - i * 0.1, -0.2);
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) head.add(screw(sx * 1.17, sy * 0.72, -0.207, true));

  let brandName = DEFAULT_BRAND;
  const labelPaint = paintedTexture(760, 400, (ctx) => {
    ctx.fillStyle = '#17171a';
    ctx.fillRect(0, 0, 760, 400);
    ctx.fillStyle = '#e9e6dc';
    ctx.font = `1000 58px ${FONT}, sans-serif`;
    ctx.fillText(brandName.toUpperCase(), 36, 86);
    ctx.font = `400 34px ${FONT}, sans-serif`;
    ctx.fillText('Лампа «Лума» · выпуск № 07', 36, 150);
  });
  {
    const label = add(head, new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.5), new THREE.MeshStandardMaterial({ map: labelPaint?.tex ?? null, color: labelPaint ? 0xffffff : 0x17171a, roughness: 0.55 })), false);
    label.position.set(-0.68, -0.46, -0.2075);
    label.rotation.y = Math.PI;
  }

  // ---------- рама из гнутого стального прутка: дуга на полу и две стойки ----------
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

  // ---------- слева барашек шарнира, справа ручка теплоты со шкалой ----------
  {
    const wing = add(spin, new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.1, 22), knurlMat));
    wing.rotation.z = Math.PI / 2;
    wing.position.set(-ARM_X - 0.1, PIVOT_Y, 0);
  }
  const dial = new THREE.Group();
  dial.position.set(ARM_X + 0.06, PIVOT_Y, 0);
  spin.add(dial);
  {
    const plate = paintedTexture(512, 512, (ctx) => {
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
    const faceMat = new THREE.MeshStandardMaterial({ map: plate?.tex ?? null, color: plate ? 0xffffff : 0x17171a, roughness: 0.6 });
    const disc = add(dial, new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 48), [coreMat, faceMat, coreMat]), false);
    disc.rotation.z = -Math.PI / 2; // торец «верх» цилиндра смотрит наружу, вдоль +x
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
  const knobTarget = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.4, 16));
  knobTarget.rotation.z = Math.PI / 2;
  knobTarget.position.x = 0.12;
  knobTarget.visible = false; // только для выбора указателем
  dial.add(knobTarget);

  // ---------- шнур: бусины и кольцо живут в координатах сцены ----------
  const N = 14, EXTRA = 10;
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.026, 12, 8), beadMat, N - 1 + EXTRA);
  beads.castShadow = true;
  beads.frustumCulled = false;
  const ring = new THREE.Group();
  {
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.021, 14, 44), steelMat);
    torus.position.y = -0.13;
    torus.castShadow = true;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 14), steelMat);
    neck.position.y = -0.005;
    ring.add(torus, neck);
  }

  // ---------- шар, в который вписана лампа без шнура (в позе по умолчанию) ----------
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible && o !== halo) box.expandByObject(o);
  });
  const center = box.getCenter(new THREE.Vector3());
  center.x = 0;
  center.z = 0;
  let reach = 0;
  for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) reach = Math.max(reach, Math.hypot(x, z));
  const radius = Math.hypot(reach, (box.max.y - box.min.y) / 2);

  return {
    root, spin, head, knob, dots, halo, beads, ring,
    shell: shellMat,
    headTargets: [frontShell, backShell, bezel],
    knobTarget,
    anchorLocal: new THREE.Vector3(-0.98, -H / 2 - 0.01, 0.04),
    halfSize: { x: W / 2 + 0.02, y: H / 2 + 0.005, z: 0.215 + 0.02 },
    center, radius,
    setBrand(name: string) {
      if (!labelPaint) return;
      brandName = name;
      labelPaint.repaint();
    },
  };
}

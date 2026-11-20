// Поведение лампы: состояние, поза, шнур, матрица и рука. Геометрию даёт model.ts, вид света studio.ts.
// Координаты указателя приходят в пикселях окна; его размер сообщает setViewport.
import * as THREE from 'three';
import { LOOK, lightStudio, type LampLight, type Studio } from '../scene/studio';
import { Chain, LAMP_CHAIN, type Vec3 } from './chain';
import { kelvinOf, kelvinRgb } from './kelvin';
import { COLS, ROWS, digitMask, fillLevels } from './matrix';
import type { LampModel } from './model';

export type Grip = { kind: 'cord'; index: number } | { kind: 'knob' } | { kind: 'head' };
/** Точка лампы для тестов: центр кольца, торец ручки, стекло панели или звено шнура по номеру. */
export type Spot = 'ring' | 'knob' | 'head' | number;
export interface LampState { on: boolean; kelvin: number; pitch: number; spin: number; digits: boolean; travel: number }

const TURN = 0.006; // рад на пиксель: поворот лампы и наклон панели
const PITCH_MIN = -0.45;
const PITCH_MAX = 1.3;
const SPIN_DRAG = 2.1; // затухание вращения после отпускания, 1/с
const PITCH_DRAG = 9; // шарнир тугой: панель доезжает чуть-чуть и встаёт
const STILL_MS = 80; // рука, замершая на это время перед отпусканием, инерции не даёт
const KNOB_TURN = 0.014; // рад на пиксель
const KNOB_REACH = 2.4; // ручка ходит на ±2.4 рад
const WARMTH = 0.28; // 2700 K
const DIGITS_TIME = 1.5; // с: сколько цифры теплоты видны после поворота ручки
const DIGITS_FADE = 0.35; // с: за сколько они растворяются в ровный свет
const FILL_ON = 0.42; // с: волна включения
const FILL_OFF = 0.3;
const TILT = 0.12; // крен лампы на единицу вытянутого шнура
const TILT_KICK = 9;
const NOD_KICK = 1.6; // панель клюёт носом от щелчка
const NUDGE = 0.011; // толчок нижним звеньям для подсказки, единиц за подшаг
const NUDGED = 5;
const HANG_HELD = 21; // 1/с: как быстро кольцо встаёт отвесно в руке
const HANG_FREE = 36; // и как быстро поворачивается вдоль шнура
const CHAIN_REST = 1e-4; // шнур в покое: звенья сдвигаются меньше этого за подшаг
const REST = 1e-4; // пружины в покое: отклонение, рад
const REST_SPEED = 1e-3; // и скорость, рад/с
const DOT_OFF = new THREE.Color(0.035, 0.035, 0.04);
const WHITE = new THREE.Color(0xffffff);
const UP = new THREE.Vector3(0, 1, 0);

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);
/** Пружина с затуханием, один шаг. Возвращает новую скорость. */
const spring = (value: number, target: number, speed: number, stiffness: number, damping: number, dt: number): number =>
  speed + ((target - value) * stiffness - speed * damping) * dt;

/**
 * Точка сцены (меняется на месте) в пикселях окна шириной width и высотой height.
 * Возвращает расстояние от камеры вдоль взгляда: у точки за камерой оно отрицательное.
 */
export function toPixels(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number, out: THREE.Vector2): number {
  const depth = -point.applyMatrix4(camera.matrixWorldInverse).z;
  point.applyMatrix4(camera.projectionMatrix);
  out.set((point.x * 0.5 + 0.5) * width, (-point.y * 0.5 + 0.5) * height);
  return depth;
}

export class Lamp {
  onChange: ((s: { on: boolean; kelvin: number }) => void) | null = null;

  private readonly model: LampModel;
  private readonly studio: Studio;
  private readonly chain = new Chain(LAMP_CHAIN);
  private readonly links = LAMP_CHAIN.points;
  private readonly segment = LAMP_CHAIN.length / (LAMP_CHAIN.points - 1);
  private readonly spinBase: number;
  private readonly ringDrop: number; // от конца шнура до центра кольца
  private readonly ringRadius: number;
  private readonly viewport = { width: 1, height: 1 };

  private lit = false;
  private power = 0; // 0..1 с пружиной: насколько лампа включена
  private powerSpeed = 0;
  private warmth = WARMTH;
  private knobAngle = (WARMTH - 0.5) * 2 * KNOB_REACH;
  private turn = 0; // поворот, который дала рука
  private turnSpeed = 0;
  private pitch: number; // наклон панели, рад (больше = смотрит ниже)
  private pitchSpeed = 0;
  private nod = 0;
  private nodSpeed = 0;
  private readonly tilt = new THREE.Vector2();
  private readonly tiltSpeed = new THREE.Vector2();
  private readonly tiltTarget = new THREE.Vector2();
  private fill = 0; // сколько колонок матрицы зажжено, 0..1
  private digitsLeft = 0; // с: сколько ещё показывать цифры
  private mask: Uint8Array;
  private readonly levels = new Float32Array(COLS * ROWS);
  private readonly glow: LampLight = { power: 0, level: 0, warmth: WARMTH, color: new THREE.Color() };
  private grip: Grip | null = null;
  private draggedAt = 0;

  private readonly anchor = new THREE.Vector3();
  private readonly socketOut = new THREE.Vector3(0, -1, 0); // куда шнур выходит из корпуса
  private readonly headInverse = new THREE.Matrix4();
  private readonly hang = new THREE.Vector3(0, 1, 0); // сглаженное направление, вдоль которого висит кольцо
  private readonly dragPlane = new THREE.Plane();
  private readonly grabOffset = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly px = new THREE.Vector2();
  private readonly v = new THREE.Vector3();
  private readonly local = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly dot = new THREE.Color();
  private readonly beamOrigin = new THREE.Vector3();
  private readonly beamDir = new THREE.Vector3();

  constructor(model: LampModel, studio: Studio) {
    this.model = model;
    this.studio = studio;
    this.spinBase = model.spin.rotation.y;
    this.pitch = model.head.rotation.x;
    // Кольцо висит ниже конца шнура: его центр и радиус берутся из самой модели.
    const ring = new THREE.Box3().setFromObject(model.ring);
    this.ringRadius = (ring.max.x - ring.min.x) / 2;
    this.ringDrop = -(ring.min.y + this.ringRadius);
    this.mask = digitMask(String(this.kelvin));
    this.glow.color.setRGB(...kelvinRgb(this.warmth), THREE.SRGBColorSpace);
    this.pose();
    this.chain.reset(this.anchor);
    this.drawChain(0);
    this.drawMatrix(0);
    lightStudio(studio, this.glow);
  }

  get on(): boolean { return this.lit; }
  get kelvin(): number { return kelvinOf(this.warmth); }

  /** Размер окна в пикселях: в нём заданы координаты указателя. */
  setViewport(width: number, height: number): void {
    this.viewport.width = width;
    this.viewport.height = height;
  }

  /** Что лежит под указателем: шнур, затем ручка, затем панель. */
  pick(xPx: number, yPx: number, radiusPx: number, camera: THREE.Camera): Grip | null {
    const index = this.cordAt(xPx, yPx, radiusPx, camera);
    if (index >= 0) return { kind: 'cord', index };
    this.aim(xPx, yPx, camera);
    if (this.raycaster.intersectObject(this.model.knobTarget, false).length > 0) return { kind: 'knob' };
    if (this.raycaster.intersectObjects(this.model.headTargets, false).length > 0) return { kind: 'head' };
    return null;
  }

  grab(grip: Grip, xPx: number, yPx: number, camera: THREE.Camera): void {
    this.grip = grip;
    this.draggedAt = performance.now();
    if (grip.kind === 'head') {
      this.turnSpeed = 0;
      this.pitchSpeed = 0;
    }
    if (grip.kind !== 'cord') return;
    const index = clamp(Math.round(grip.index), 1, this.links - 1);
    this.grip = { kind: 'cord', index };
    this.chain.grab(index);
    // Звено ведётся в плоскости, обращённой к камере, и остаётся на том же месте под курсором: при нажатии ничего не прыгает.
    const held = this.link(index, this.v);
    this.dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(this.local), held);
    this.grabOffset.set(0, 0, 0);
    if (this.aim(xPx, yPx, camera).intersectPlane(this.dragPlane, this.local)) this.grabOffset.copy(held).sub(this.local);
  }

  drag(xPx: number, yPx: number, dxPx: number, dyPx: number, dt: number, camera: THREE.Camera): void {
    const grip = this.grip;
    if (!grip) return;
    this.draggedAt = performance.now();
    if (grip.kind === 'cord') {
      if (this.aim(xPx, yPx, camera).intersectPlane(this.dragPlane, this.v)) this.chain.moveHeld(this.v.add(this.grabOffset));
    } else if (grip.kind === 'head') {
      // вбок: вся лампа поворачивается; вверх-вниз: панель качается в раме
      this.turn += dxPx * TURN;
      this.turnSpeed = THREE.MathUtils.lerp(this.turnSpeed, (dxPx * TURN) / dt, 0.5);
      const before = this.pitch;
      this.pitch = clamp(this.pitch + dyPx * TURN, PITCH_MIN, PITCH_MAX);
      this.pitchSpeed = THREE.MathUtils.lerp(this.pitchSpeed, (this.pitch - before) / dt, 0.5);
    } else {
      const before = this.kelvin;
      this.knobAngle = clamp(this.knobAngle + (dxPx - dyPx) * KNOB_TURN, -KNOB_REACH, KNOB_REACH);
      this.warmth = (this.knobAngle + KNOB_REACH) / (2 * KNOB_REACH);
      this.glow.color.setRGB(...kelvinRgb(this.warmth), THREE.SRGBColorSpace);
      this.digitsLeft = DIGITS_TIME;
      if (this.kelvin !== before) {
        this.mask = digitMask(String(this.kelvin));
        this.emit();
      }
    }
  }

  /** tap: сдвиг меньше 6 px и нажатие короче 400 мс. Такое касание шнура равно рывку. */
  release(tap: boolean): void {
    const grip = this.grip;
    if (!grip) return;
    this.grip = null;
    if (grip.kind === 'cord') {
      this.chain.release();
      if (tap) this.chain.tug();
    } else if (grip.kind === 'head' && performance.now() - this.draggedAt > STILL_MS) {
      this.turnSpeed = 0;
      this.pitchSpeed = 0;
    }
  }

  /** То же, что рывок шнура: шнур дёргается сам, на середине хода лампа переключается. */
  toggle(): void {
    this.chain.tug();
  }

  /** Лёгкое покачивание шнура: подсказка, что за него можно потянуть. */
  nudge(): void {
    if (this.grip) return;
    for (let i = this.links - NUDGED; i < this.links; i += 1) this.chain.pos[i * 3] += NUDGE;
  }

  /** Шаг времени. true, пока что-то движется. */
  update(dt: number): boolean {
    const target = this.lit ? 1 : 0;
    this.powerSpeed = spring(this.power, target, this.powerSpeed, 150, 19, dt);
    this.power += this.powerSpeed * dt;
    if (this.grip?.kind !== 'head') {
      this.turn += this.turnSpeed * dt;
      this.turnSpeed *= Math.exp(-SPIN_DRAG * dt);
      this.pitch = clamp(this.pitch + this.pitchSpeed * dt, PITCH_MIN, PITCH_MAX);
      this.pitchSpeed *= Math.exp(-PITCH_DRAG * dt);
    }
    this.tiltSpeed.x = spring(this.tilt.x, this.tiltTarget.x, this.tiltSpeed.x, 150, 8, dt);
    this.tiltSpeed.y = spring(this.tilt.y, this.tiltTarget.y, this.tiltSpeed.y, 150, 8, dt);
    this.tilt.addScaledVector(this.tiltSpeed, dt);
    this.nodSpeed = spring(this.nod, 0, this.nodSpeed, 140, 9, dt);
    this.nod += this.nodSpeed * dt;
    this.pose();

    const chain = this.chain;
    const clicked = chain.step(dt, this.anchor, this.socketOut, this.keepOut);
    // пока шнур вытянут рукой, лампа кренится за ним
    if (chain.held >= 0 && chain.travel > 0) this.tiltTarget.set(chain.travelDir.z, chain.travelDir.x).multiplyScalar(chain.travel * TILT);
    else this.tiltTarget.set(0, 0);
    if (clicked) {
      this.tiltSpeed.addScaledVector(this.tiltTarget, TILT_KICK);
      this.nodSpeed += NOD_KICK;
      this.lit = !this.lit;
      this.emit();
    }

    this.drawChain(dt);
    this.drawMatrix(dt);
    this.glow.power = this.power;
    this.glow.warmth = this.warmth;
    lightStudio(this.studio, this.glow);
    return this.settle();
  }

  /** Свет лампы для страницы: level (средняя яркость матрицы), power (насколько включена), откуда и куда светит панель. */
  light(): { level: number; power: number; origin: THREE.Vector3; dir: THREE.Vector3 } {
    return {
      level: this.glow.level,
      power: clamp(this.power, 0, 1),
      origin: this.model.head.getWorldPosition(this.beamOrigin),
      dir: this.model.head.getWorldDirection(this.beamDir),
    };
  }

  state(): LampState {
    return {
      on: this.lit,
      kelvin: this.kelvin,
      pitch: this.pitch,
      spin: this.model.spin.rotation.y,
      digits: this.digitsLeft > 0 && this.fill > 0.6,
      travel: this.chain.travel,
    };
  }

  /** Точка лампы в координатах сцены. */
  point(what: Spot, out: THREE.Vector3): THREE.Vector3 {
    if (what === 'ring') return this.model.ring.localToWorld(out.set(0, -this.ringDrop, 0));
    if (what === 'knob') return this.model.knob.localToWorld(out.set(0.16, 0, 0));
    if (what === 'head') return this.model.head.localToWorld(out.set(0.3, 0.1, 0.22));
    return this.link(clamp(Math.round(what), 0, this.links - 1), out);
  }

  /** Высота низа кольца над столом и признак, что его центр внутри корпуса панели. */
  ring(): { aboveFloor: number; insidePanel: boolean } {
    const { ring, head, halfSize } = this.model;
    let low = Infinity;
    for (let k = 0; k < 16; k += 1) {
      const a = (k * Math.PI) / 8;
      low = Math.min(low, ring.localToWorld(this.v.set(Math.cos(a) * this.ringRadius, Math.sin(a) * this.ringRadius - this.ringDrop, 0)).y);
    }
    const c = head.worldToLocal(this.point('ring', this.v));
    return { aboveFloor: low, insidePanel: Math.abs(c.x) < halfSize.x && Math.abs(c.y) < halfSize.y && Math.abs(c.z) < halfSize.z };
  }

  private emit(): void {
    this.onChange?.({ on: this.lit, kelvin: this.kelvin });
  }

  private link(index: number, out: THREE.Vector3): THREE.Vector3 {
    const { pos } = this.chain;
    return out.set(pos[index * 3], pos[index * 3 + 1], pos[index * 3 + 2]);
  }

  private pose(): void {
    const { root, spin, head, knob, anchorLocal } = this.model;
    root.rotation.set(this.tilt.x, 0, -this.tilt.y);
    spin.rotation.y = this.spinBase + this.turn;
    head.rotation.x = this.pitch + this.nod;
    knob.rotation.x = -this.knobAngle;
    root.updateMatrixWorld(true);
    this.anchor.copy(anchorLocal).applyMatrix4(head.matrixWorld);
    this.headInverse.copy(head.matrixWorld).invert();
    this.socketOut.set(0, -1, 0).transformDirection(head.matrixWorld);
  }

  /** Выталкивает точку из корпуса панели наружу через ближайшую грань: шнур и кольцо сквозь панель не проходят. */
  private readonly keepOut = (p: Vec3, margin: number): void => {
    const l = this.local.set(p.x, p.y, p.z).applyMatrix4(this.headInverse);
    const { halfSize, head } = this.model;
    const hx = halfSize.x + margin, hy = halfSize.y + margin, hz = halfSize.z + margin;
    const px = hx - Math.abs(l.x), py = hy - Math.abs(l.y), pz = hz - Math.abs(l.z);
    if (px <= 0 || py <= 0 || pz <= 0) return;
    if (pz <= px && pz <= py) l.z = (l.z < 0 ? -1 : 1) * hz;
    else if (py <= px) l.y = (l.y > 0 ? 1 : -1) * hy;
    else l.x = (l.x < 0 ? -1 : 1) * hx;
    l.applyMatrix4(head.matrixWorld);
    p.x = l.x;
    p.y = l.y;
    p.z = l.z;
  };

  /** Луч от камеры через пиксель окна. */
  private aim(xPx: number, yPx: number, camera: THREE.Camera): THREE.Ray {
    this.ndc.set((xPx / this.viewport.width) * 2 - 1, -(yPx / this.viewport.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    return this.raycaster.ray;
  }

  /** Звено шнура под указателем или -1. Кольцо на конце считается последним звеном, и попасть в него легче. */
  private cordAt(xPx: number, yPx: number, radiusPx: number, camera: THREE.Camera): number {
    const last = this.links - 1;
    const { width, height } = this.viewport;
    const depth = toPixels(this.point('ring', this.v), camera, width, height, this.px);
    if (depth > 0) {
      const perUnit = (0.5 * height * camera.projectionMatrix.elements[5]) / depth;
      if (Math.hypot(this.px.x - xPx, this.px.y - yPx) < this.ringRadius * perUnit + radiusPx * 0.6) return last;
    }
    let best = -1;
    let nearest = radiusPx;
    for (let i = 1; i <= last; i += 1) {
      if (toPixels(this.link(i, this.v), camera, width, height, this.px) <= 0) continue;
      const d = Math.hypot(this.px.x - xPx, this.px.y - yPx);
      if (d < nearest) {
        nearest = d;
        best = i;
      }
    }
    return best;
  }

  private drawChain(dt: number): void {
    const { beads, ring } = this.model;
    const { pos, travel, travelDir } = this.chain;
    const last = this.links - 1;
    for (let i = 0; i < last; i += 1) beads.setMatrixAt(i, this.matrix.makeTranslation(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
    // запас звеньев выходит из корпуса вслед за шнуром, когда его тянут
    for (let j = 1; last - 1 + j < beads.count; j += 1) {
      const d = Math.max(travel - j * this.segment, 0);
      beads.setMatrixAt(last - 1 + j, this.matrix.makeTranslation(this.anchor.x + travelDir.x * d, this.anchor.y + travelDir.y * d, this.anchor.z + travelDir.z * d));
    }
    beads.instanceMatrix.needsUpdate = true;

    // Кольцо поворачивается вдоль шнура, а в руке встаёт отвесно: так оно не опрокидывается, когда его поднимают выше шнура.
    const inHand = this.grip?.kind === 'cord' && this.grip.index === last;
    if (inHand) this.v.copy(UP);
    else this.link(last - 1, this.v).sub(this.link(last, this.local)).normalize();
    this.hang.lerp(this.v, 1 - Math.exp(-(inHand ? HANG_HELD : HANG_FREE) * dt)).normalize();
    this.link(last, ring.position);
    ring.quaternion.setFromUnitVectors(UP, this.hang);
    ring.updateMatrixWorld();
  }

  private drawMatrix(dt: number): void {
    const { dots, halo } = this.model;
    const glow = this.glow;
    this.fill += clamp((this.lit ? 1 : 0) - this.fill, -dt / FILL_OFF, dt / FILL_ON);
    this.digitsLeft = Math.max(0, this.digitsLeft - dt);
    // цифры плавно растворяются обратно в ровный свет
    glow.level = fillLevels(this.fill, this.mask, Math.min(this.digitsLeft / DIGITS_FADE, 1), this.levels);
    for (let i = 0; i < this.levels.length; i += 1) {
      const b = this.levels[i];
      dots.setColorAt(i, this.dot.copy(DOT_OFF).lerp(glow.color, Math.min(b * 4, 1)).multiplyScalar(1 + b * (LOOK.dots - 1)));
    }
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    const haze = halo.material as THREE.MeshBasicMaterial;
    haze.opacity = glow.level * LOOK.halo;
    haze.color.copy(glow.color).lerp(WHITE, 0.4);
  }

  /** Досылает замершие пружины в цель и отвечает, движется ли ещё что-нибудь. */
  private settle(): boolean {
    const target = this.lit ? 1 : 0;
    // Рука считается движущейся, пока она двигалась не раньше STILL_MS назад: неподвижная рука кадры не требует.
    let moving = (this.grip !== null && performance.now() - this.draggedAt < STILL_MS) || this.fill !== target || this.digitsLeft > 0;
    if (Math.abs(target - this.power) > REST || Math.abs(this.powerSpeed) > REST_SPEED) moving = true;
    else {
      this.power = target;
      this.powerSpeed = 0;
    }
    if (Math.abs(this.turnSpeed) > REST_SPEED) moving = true;
    else this.turnSpeed = 0;
    if (Math.abs(this.pitchSpeed) > REST_SPEED) moving = true;
    else this.pitchSpeed = 0;
    if (this.tilt.distanceTo(this.tiltTarget) > REST || this.tiltSpeed.length() > REST_SPEED) moving = true;
    else {
      this.tilt.copy(this.tiltTarget);
      this.tiltSpeed.set(0, 0);
    }
    if (Math.abs(this.nod) > REST || Math.abs(this.nodSpeed) > REST_SPEED) moving = true;
    else {
      this.nod = 0;
      this.nodSpeed = 0;
    }
    if (this.chain.maxSpeed() > CHAIN_REST || this.chain.travel > REST) moving = true;
    return moving;
  }
}

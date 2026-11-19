export interface Vec3 { x: number; y: number; z: number }
/** Выталкивает точку из корпуса, меняя её на месте. */
export type KeepOut = (p: Vec3, margin: number) => void;
export interface ChainConfig { points: number; length: number; travel: number; endReach: number; floorY: number }
export const LAMP_CHAIN: ChainConfig = { points: 14, length: 0.7, travel: 0.4, endReach: 0.24, floorY: 0.03 };

const GRAVITY = 98;
const SUBSTEP = 1 / 120;
const MAX_ACCUMULATED = 0.1;
const DAMPING = 0.992;
// Слабое качание гаснет быстрее сильного, как от трения в звеньях: шнур встаёт за три секунды,
// а не качается ещё столько же с размахом меньше пикселя, не давая сцене уснуть.
const CALM_SPEED = 6e-3; // единиц за подшаг: ниже этой скорости затухание растёт
const CALM_DAMPING = 0.95;
const PASSES = 14;
const TUG_TIME = 0.28;
const RELEASE_DECAY = 26;
const LINK_MARGIN = 0.03;
const RING_MARGIN = 0.11;
const HELD_FLOOR = 0.05;
const OUTWARD_MIN = 0.25;
const REARM_FRACTION = 0.35;
const OVERSHOOT = 0.1;

export class Chain {
  readonly pos: Float32Array;
  readonly travelDir: Vec3 = { x: 0, y: -1, z: 0 };
  travel = 0;
  held = -1;

  private readonly cfg: ChainConfig;
  private readonly n: number;
  private readonly segment: number;
  private readonly prev: Float32Array;
  private readonly target: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly scratch: Vec3 = { x: 0, y: 0, z: 0 };
  private acc = 0;
  private armed = true;
  private auto = -1;
  private autoFired = false;
  private speed = 0;
  private clicked = false;

  constructor(cfg: ChainConfig) {
    this.cfg = cfg;
    this.n = cfg.points;
    this.segment = cfg.length / (cfg.points - 1);
    this.pos = new Float32Array(this.n * 3);
    this.prev = new Float32Array(this.n * 3);
  }

  reset(anchor: Vec3): void {
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      this.pos[k] = anchor.x;
      this.pos[k + 1] = anchor.y - i * this.segment;
      this.pos[k + 2] = anchor.z;
    }
    this.prev.set(this.pos);
    this.travelDir.x = 0; this.travelDir.y = -1; this.travelDir.z = 0;
    this.travel = 0;
    this.held = -1;
    this.acc = 0;
    this.armed = true;
    this.auto = -1;
    this.autoFired = false;
    this.speed = 0;
  }

  grab(index: number): void {
    this.held = index;
    const k = index * 3;
    this.target.x = this.pos[k];
    this.target.y = this.pos[k + 1];
    this.target.z = this.pos[k + 2];
  }

  moveHeld(target: Vec3): void {
    this.target.x = target.x; this.target.y = target.y; this.target.z = target.z;
  }

  release(): void {
    this.held = -1;
  }

  tug(): void {
    this.auto = 0;
    this.autoFired = false;
  }

  step(dt: number, anchor: Vec3, out: Vec3, keepOut?: KeepOut): boolean {
    this.clicked = false;
    if (this.auto >= 0) {
      this.auto += dt;
      const ph = this.auto / TUG_TIME;
      this.travel = this.cfg.travel * Math.sin(Math.PI * Math.min(ph, 1));
      this.travelDir.x = out.x; this.travelDir.y = out.y; this.travelDir.z = out.z;
      if (ph >= 0.5 && !this.autoFired) {
        this.autoFired = true;
        this.clicked = true;
      }
      if (ph >= 1) { this.auto = -1; this.travel = 0; }
    } else if (this.held < 0) {
      this.travel *= Math.exp(-RELEASE_DECAY * dt);
    }
    this.acc = Math.min(this.acc + dt, MAX_ACCUMULATED);
    while (this.acc >= SUBSTEP) {
      this.substep(anchor, out, keepOut);
      this.acc -= SUBSTEP;
    }
    return this.clicked;
  }

  maxSpeed(): number {
    return this.speed;
  }

  private substep(anchor: Vec3, out: Vec3, keepOut?: KeepOut): void {
    const { pos, prev, n, segment, cfg } = this;
    const damping = CALM_DAMPING + (DAMPING - CALM_DAMPING) * Math.min(this.speed / CALM_SPEED, 1);
    for (let i = 1; i < n; i++) {
      const k = i * 3;
      for (let a = 0; a < 3; a++) {
        const v = (pos[k + a] - prev[k + a]) * damping;
        prev[k + a] = pos[k + a];
        pos[k + a] += v;
      }
      pos[k + 1] -= GRAVITY * SUBSTEP * SUBSTEP;
    }

    const pin = this.held;
    if (pin >= 0) this.placeHeld(anchor, out, keepOut);

    const x0 = anchor.x + this.travelDir.x * this.travel;
    const y0 = anchor.y + this.travelDir.y * this.travel;
    const z0 = anchor.z + this.travelDir.z * this.travel;
    for (let it = 0; it < PASSES; it++) {
      pos[0] = x0; pos[1] = y0; pos[2] = z0;
      for (let i = 0; i < n - 1; i++) {
        const a = i * 3, b = a + 3;
        const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (d - segment) / d;
        const pinA = i === 0 || i === pin;
        const pinB = i + 1 === pin;
        const wa = pinA ? 0 : pinB ? 1 : 0.5;
        const wb = pinB ? 0 : pinA ? 1 : 0.5;
        pos[a] += dx * diff * wa; pos[a + 1] += dy * diff * wa; pos[a + 2] += dz * diff * wa;
        pos[b] -= dx * diff * wb; pos[b + 1] -= dy * diff * wb; pos[b + 2] -= dz * diff * wb;
      }
      for (let i = 1; i < n; i++) {
        if (i === pin) continue;
        const k = i * 3;
        const last = i === n - 1;
        const minY = last ? cfg.floorY + cfg.endReach : cfg.floorY;
        if (pos[k + 1] < minY) pos[k + 1] = minY;
        if (keepOut) {
          const p = this.scratch;
          p.x = pos[k]; p.y = pos[k + 1]; p.z = pos[k + 2];
          keepOut(p, last ? RING_MARGIN : LINK_MARGIN);
          pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z;
        }
      }
    }

    let max = 0;
    for (let i = 1; i < n; i++) {
      const k = i * 3;
      max = Math.max(max, Math.hypot(pos[k] - prev[k], pos[k + 1] - prev[k + 1], pos[k + 2] - prev[k + 2]));
    }
    this.speed = max;
  }

  /** Ставит взятое звено туда, куда ведёт рука, и считает вытяжку шнура из корпуса. */
  private placeHeld(anchor: Vec3, out: Vec3, keepOut?: KeepOut): void {
    const { cfg, pos, held } = this;
    const byRing = held === this.n - 1;
    const rest = held * this.segment;
    const h = this.scratch;
    h.x = this.target.x; h.y = this.target.y; h.z = this.target.z;
    h.y = Math.max(h.y, byRing ? cfg.floorY + cfg.endReach : HELD_FLOOR);
    keepOut?.(h, byRing ? RING_MARGIN : LINK_MARGIN);

    let tx = h.x - anchor.x, ty = h.y - anchor.y, tz = h.z - anchor.z;
    const len = Math.hypot(tx, ty, tz) || 1e-6;
    let excess = Math.max(0, len - rest);
    const outward = excess > 0 && (tx * out.x + ty * out.y + tz * out.z) / len > OUTWARD_MIN;
    if (excess > 0 && !outward) {
      const s = rest / len;
      tx *= s; ty *= s; tz *= s;
      excess = 0;
    }
    if (excess > 0) {
      const over = Math.max(0, excess - cfg.travel);
      this.travel = Math.min(excess, cfg.travel) + OVERSHOOT * (1 - Math.exp(-over / OVERSHOOT));
      this.travelDir.x = tx / len; this.travelDir.y = ty / len; this.travelDir.z = tz / len;
      tx = this.travelDir.x * (rest + this.travel);
      ty = this.travelDir.y * (rest + this.travel);
      tz = this.travelDir.z * (rest + this.travel);
      const floor = (byRing ? cfg.floorY + cfg.endReach : HELD_FLOOR) - anchor.y;
      if (ty < floor) ty = floor;
    } else {
      this.travel = 0;
    }
    const g = held * 3;
    pos[g] = anchor.x + tx;
    pos[g + 1] = anchor.y + ty;
    pos[g + 2] = anchor.z + tz;

    if (this.armed && excess >= cfg.travel) {
      this.armed = false;
      this.clicked = true;
    } else if (!this.armed && excess < cfg.travel * REARM_FRACTION) {
      this.armed = true;
    }
  }
}

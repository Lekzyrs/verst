// Свет лампы на странице: где лежит пятно, насколько оно ярко и вокруг какой точки темнеет остальная страница.
// Чистая математика: ни DOM, ни рендерера. Всё, что получает страница, непрерывно зависит от положения лампы:
// пятно гаснет плавно, прежде чем исчезнуть, а центр спада плавно перетекает от подножия лампы к центру пятна.
import * as THREE from 'three';

/** Точка сцены (проектор может менять её на месте) в пиксели окна. Возвращает глубину перед камерой, то есть w: за камерой она ≤ 0. */
type Project = (point: THREE.Vector3, out: THREE.Vector2) => number;

export interface PageLightInput {
  /** Центр панели и направление её луча в координатах сцены; стол лежит на y = 0. */
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  /** Средняя яркость матрицы, 0..1. */
  level: number;
  project: Project;
  width: number;
  height: number;
}

export interface PageLight {
  /** matrix — CSS matrix(a, b, c, d, e, f) для пятна 200×200 с центром в начале координат; null, когда пятна нет (прозрачность 0). */
  pool: { matrix: [number, number, number, number, number, number]; opacity: number } | null;
  /** Центр спада света в пикселях окна. */
  centre: { x: number; y: number };
}

const REACH_CAP = 14; // дальше луч на стол не кладётся
const REACH_FADE_FROM = 5.5; // с этого расстояния до центра пятна оно начинает гаснуть и к REACH_FADE_TO гаснет совсем
const REACH_FADE_TO = 9.5;
const BEAM_FLAT = -0.08; // луч с таким наклоном идёт почти по горизонту: пятна нет
const BEAM_STEEP = -0.2; // и с этим наклоном пятно уже в полной силе
const STEP = 0.5; // шаг в единицах сцены для локальной аффинной проекции
const NEAR_FROM = 0.5; // глубина центра пятна в долях глубины подножия лампы: ближе этого пятна нет, дальше этого проекция годится
const NEAR_TO = 0.75;
const EDGE_NEAR = 0.03; // глубина края пятна в долях глубины его центра: ближе проекция края не используется совсем,
const EDGE_SAFE = 0.07; // а дальше используется целиком
const SPAN_FROM = 5; // полудлина пятна на экране в размерах окна: до неё как есть, дальше сжимается к SPAN_TO
const SPAN_TO = 8;
const LEVEL_FULL = 0.2; // яркость матрицы, с которой центр спада уже целиком у пятна
const OFF_FROM = 0.5; // на сколько размеров окна центр пятна может выйти за окно, пока оно не начало гаснуть
const OFF_TO = 1.5;
const SOFT_MARGIN = 0.3; // насколько центр спада может выйти за окно (в размерах окна)

const smooth = (x: number, from: number, to: number): number => {
  const t = THREE.MathUtils.clamp((x - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Пропускает значение внутри [lo, hi] как есть, а дальше плавно прижимает его к границе не ближе margin. */
const soften = (v: number, lo: number, hi: number, margin: number): number =>
  v > hi ? hi + margin * Math.tanh((v - hi) / margin) : v < lo ? lo - margin * Math.tanh((lo - v) / margin) : v;

const centre3 = new THREE.Vector3();
const along = new THREE.Vector3();
const across = new THREE.Vector3();
const probe = new THREE.Vector3();
const foot = new THREE.Vector2();
const pc = new THREE.Vector2();
const pa = new THREE.Vector2();
const pb = new THREE.Vector2();

/** Мягкий потолок длины: до SPAN_FROM размеров окна вектор не меняется, дальше он прижимается к SPAN_TO. */
function capSpan(centre: THREE.Vector2, out: THREE.Vector2, size: number): void {
  const dx = out.x - centre.x;
  const dy = out.y - centre.y;
  const len = Math.hypot(dx, dy);
  const from = SPAN_FROM * size;
  if (len <= from) return;
  const room = (SPAN_TO - SPAN_FROM) * size;
  const k = (from + room * Math.tanh((len - from) / room)) / len;
  out.set(centre.x + dx * k, centre.y + dy * k);
}

const sideProbe = new THREE.Vector3();
const side = new THREE.Vector2();

/**
 * Экранная точка на расстоянии far от центра вдоль оси (единичный вектор по столу), записывается в out.
 * Далёкая точка не проецируется: вдоль прямой на столе глубина w и произведения x·w, y·w линейны, поэтому проекции центра
 * и пробной точки на шаге STEP хватает, чтобы получить край точно. Пока край заметно впереди камеры, берётся он.
 * Ближе к плоскости камеры он уходит в бесконечность, и тогда матрица плавно переходит к локальной аффинной:
 * наклон проекции в центре, умноженный на far / STEP.
 */
function edgeRaw(centre: THREE.Vector2, centreDepth: number, axis: THREE.Vector3, far: number, project: Project, out: THREE.Vector2): void {
  const depth = project(sideProbe.copy(centre3).addScaledVector(axis, STEP), side);
  const gain = far / STEP;
  const affineX = centre.x + (side.x - centre.x) * gain;
  const affineY = centre.y + (side.y - centre.y) * gain;
  const endDepth = centreDepth + (depth - centreDepth) * gain;
  const keep = smooth(endDepth / centreDepth, EDGE_NEAR, EDGE_SAFE);
  if (keep <= 0) {
    out.set(affineX, affineY);
    return;
  }
  const exactX = (centre.x * centreDepth + (side.x * depth - centre.x * centreDepth) * gain) / endDepth;
  const exactY = (centre.y * centreDepth + (side.y * depth - centre.y * centreDepth) * gain) / endDepth;
  out.set(affineX + (exactX - affineX) * keep, affineY + (exactY - affineY) * keep);
}

export function pageLight({ origin, dir, level, project, width, height }: PageLightInput): PageLight {
  const footDepth = project(probe.set(origin.x, 0, origin.z), foot);
  const size = Math.max(width, height);

  // Пятно: луч из центра панели вдоль её нормали упирается в стол. reach — до какой точки, но не дальше REACH_CAP.
  const toFloor = dir.y < 0 ? -origin.y / dir.y : Infinity;
  const reach = Math.min(toFloor, REACH_CAP);
  centre3.set(origin.x + dir.x * reach, 0, origin.z + dir.z * reach);
  const poolDepth = project(probe.copy(centre3), pc);

  // Видимость, 0..1: каждый множитель непрерывен и обнуляется раньше, чем пятно становится негодным.
  const outside = Math.hypot(Math.max(0, -pc.x, pc.x - width), Math.max(0, -pc.y, pc.y - height));
  const visible =
    smooth(dir.y, BEAM_FLAT, BEAM_STEEP) *
    (1 - smooth(toFloor, REACH_FADE_FROM, REACH_FADE_TO)) *
    smooth(footDepth > 0 ? poolDepth / footDepth : 0, NEAR_FROM, NEAR_TO) *
    (1 - smooth(outside, OFF_FROM * size, OFF_TO * size));
  const opacity = level * THREE.MathUtils.clamp(1.35 - reach / 9, 0.3, 1) * visible;

  let pool: PageLight['pool'] = null;
  if (opacity > 0) {
    const wide = 1.7 + reach * 0.62;
    const length = wide * Math.min(1 / Math.max(-dir.y, 0.22), 2.4); // чем положе луч, тем длиннее пятно
    const flat = Math.hypot(dir.x, dir.z);
    along.set(flat > 1e-6 ? dir.x / flat : 0, 0, flat > 1e-6 ? dir.z / flat : 1);
    across.set(-along.z, 0, along.x);
    // Матрицу дают проекции центра и двух точек рядом (вдоль луча и поперёк); далёкие точки пятна не проецируются.
    edgeRaw(pc, poolDepth, along, length, project, pa);
    edgeRaw(pc, poolDepth, across, wide, project, pb);
    capSpan(pc, pa, size);
    capSpan(pc, pb, size);
    pool = {
      matrix: [(pa.x - pc.x) / 100, (pa.y - pc.y) / 100, (pb.x - pc.x) / 100, (pb.y - pc.y) / 100, pc.x, pc.y],
      opacity,
    };
  }

  // Центр спада: от подножия лампы к центру пятна, с тем же весом, с каким гаснет пятно.
  const weight = visible * smooth(level, 0, LEVEL_FULL);
  const x = foot.x + (pc.x - foot.x) * weight;
  const y = foot.y + (pc.y - foot.y) * weight;
  return {
    pool,
    centre: {
      x: soften(x, 0, width, SOFT_MARGIN * size),
      y: soften(y, 0, height, SOFT_MARGIN * size),
    },
  };
}

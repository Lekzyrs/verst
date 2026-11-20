// Камера сцены: ракурс и рамка. Без DOM и рендерера, чтобы одну и ту же камеру строили сцена и тесты.
import * as THREE from 'three';
import { frameToRect, type Rect } from '../core/frame';

export const FOV = 28;
const VIEW_FROM = new THREE.Vector3(0.3, 1.0, 14.6).normalize(); // откуда камера смотрит на центр лампы
// Какую долю меньшей стороны рамки занимает шар, в который вписана лампа. Больше единицы, потому что шар модели взят с запасом:
// по углам габаритной коробки и на поворот вокруг любой оси, а лампа вращается только вокруг вертикали и в полтора раза уже него.
// При 1.17 она на любом повороте занимает около 80 % меньшей стороны рамки, как в прототипе.
const FILL = 1.17;
const DEPTH_BEFORE = 12; // сколько сцены перед лампой и за ней попадает в кадр: тени на столе длиннее самой лампы
const DEPTH_BEHIND = 40;

/**
 * Ставит камеру (w×h пикселей окна) так, чтобы шар модели занял рамку метки сцены.
 * Возвращает, сколько пикселей в единице сцены у лампы.
 */
export function frameCamera(camera: THREE.PerspectiveCamera, w: number, h: number, stage: Rect, ball: { center: THREE.Vector3; radius: number }): number {
  const frame = frameToRect(w, h, FOV, stage, ball.radius, FILL);
  camera.aspect = w / h;
  camera.near = Math.max(0.1, frame.distance - DEPTH_BEFORE);
  camera.far = frame.distance + DEPTH_BEHIND;
  camera.updateProjectionMatrix();
  // Сдвиг проекции переносит лампу в рамку метки, не меняя ракурса: камера по-прежнему смотрит на неё прямо.
  camera.projectionMatrix.elements[8] = -frame.shiftX;
  camera.projectionMatrix.elements[9] = -frame.shiftY;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.position.copy(ball.center).addScaledVector(VIEW_FROM, frame.distance);
  camera.lookAt(ball.center);
  camera.updateMatrixWorld();
  return h / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * frame.distance);
}

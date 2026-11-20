import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { buildLamp, type LampModel } from '../../src/lamp/model';
import { FONT_FAMILY } from '../../src/page/contract';

const boxOf = (m: LampModel) => { const b = new THREE.Box3(); m.root.updateMatrixWorld(true); m.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible && o !== m.halo) b.expandByObject(o); }); return b; };

describe('модель лампы', () => {
  test('лампа стоит на столе', () => { const b = boxOf(buildLamp()); expect(b.min.y).toBeGreaterThanOrEqual(-0.01); expect(b.max.y).toBeGreaterThan(2.6); expect(b.max.y).toBeLessThan(3.6); });
  test('лампа помещается в свой шар', () => { const m = buildLamp(); const b = boxOf(m); for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) expect(new THREE.Vector3(x, y, z).distanceTo(m.center)).toBeLessThanOrEqual(m.radius + 0.01); });
  test('матрица 24 на 14', () => { expect(buildLamp().dots.count).toBe(336); });
  test('шнур выходит из нижней кромки панели', () => { const m = buildLamp(); expect(m.anchorLocal.y).toBeLessThan(-m.halfSize.y + 0.02); });
});

describe('шильдик на задней стороне лампы', () => {
  /** Подменяет document: холст запоминает шрифты, которыми рисуют, и язык, а document.fonts запоминает, что просили загрузить. */
  async function withDom(): Promise<{ fonts: string[]; langs: string[]; loaded: string[]; build: () => LampModel }> {
    const fonts: string[] = [];
    const langs: string[] = [];
    const loaded: string[] = [];
    const makeCanvas = () => {
      const canvas = {
        width: 0,
        height: 0,
        lang: '',
        getContext: () => {
          const target: Record<string, unknown> = { lang: '' };
          return new Proxy(target, {
            get: (t, key: string) => {
              if (key in t) return t[key];
              if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
              return () => ({ addColorStop() {} });
            },
            set: (t, key: string, value) => {
              t[key] = value;
              if (key === 'font') { fonts.push(String(value)); langs.push(`${canvas.lang}/${String(t.lang)}`); }
              return true;
            },
          });
        },
      };
      return canvas;
    };
    vi.stubGlobal('document', { createElement: () => makeCanvas(), fonts: { load: (spec: string) => { loaded.push(spec); return Promise.resolve([]); } } });
    vi.resetModules();
    const model = await import('../../src/lamp/model');
    return { fonts, langs, loaded, build: model.buildLamp };
  }

  test('рисуется шрифтом страницы: одно имя семейства в контракте', async () => {
    const { fonts, loaded, build } = await withDom();
    try {
      build();
      const label = fonts.filter((f) => f.startsWith('1000 58px') || f.startsWith('400 34px'));
      expect(label).toHaveLength(2);
      for (const f of label) expect(f).toContain(FONT_FAMILY);
      expect(fonts.join('|')).not.toMatch(/"Sofia Sans"/);
      expect(loaded.length).toBeGreaterThan(0);
      for (const spec of loaded) expect(spec).toBe(`1000 40px ${FONT_FAMILY}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('шильдик размечен как русский текст: холст и контекст получают lang ru до рисования', async () => {
    const { fonts, langs, build } = await withDom();
    try {
      build();
      const i = fonts.findIndex((f) => f.startsWith('1000 58px'));
      expect(langs[i]).toBe('ru/ru');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

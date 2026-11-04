import { describe, it, expect } from 'vitest';
import { computeLab, directArrivals, pointAtTime, LAB_DEFAULT, LAB_PRESETS, targetStatus, SONAR_EQ, type LabSetup } from '../src/sonar/lab/model';

const preset = (id: string): LabSetup => ({ ...LAB_DEFAULT, ...LAB_PRESETS.find((p) => p.id === id)!.setup });

describe('laboratório acústico', () => {
  it('água uniforme: frente de onda direta é um círculo de raio 1500·t', () => {
    const res = computeLab(preset('uniforme'));
    const s = res.setup,
      t = 0.6;
    let n = 0;
    for (const ray of res.rays) {
      const p = pointAtTime(ray, t);
      if (!p || ray.points.slice(0, p.i + 1).some((q) => q.event)) continue;
      expect(Math.hypot(p.r, p.z - s.subDepth)).toBeCloseTo(1500 * t, -1);
      n++;
    }
    expect(n).toBeGreaterThan(20);
    expect(res.shadow).toBeNull();
  });

  it('água uniforme: eco chega em 2·d/c e a distância medida bate com a real', () => {
    const res = computeLab(preset('uniforme'));
    const d = Math.hypot(res.setup.targetRange, res.setup.targetDepth - res.setup.subDepth);
    expect(res.arrivals[0].kind).toBe('direto');
    expect(res.firstArrival!).toBeCloseTo(d / 1500, 2);
    expect(res.echoTime!).toBeCloseTo((2 * d) / 1500, 2);
    expect(res.measuredRange!).toBeCloseTo(d, -1);
    // direto, reflexo na superfície e no fundo
    expect(res.arrivals.map((a) => a.kind)).toEqual(expect.arrayContaining(['direto', 'superfície', 'fundo']));
  });

  it('abaixo da camada: zona de sombra e alvo sem caminho direto', () => {
    const res = computeLab(preset('camada'));
    expect(res.shadow).not.toBeNull();
    expect(directArrivals(res)).toHaveLength(0);
    expect(targetStatus(res).tone).not.toBe('ok');
    // trazendo o alvo para perto e para a mesma profundidade, ele volta a ser alcançado diretamente
    const near = computeLab({ ...res.setup, targetRange: 1500, targetDepth: res.setup.subDepth });
    expect(near.arrivals[0].kind).toBe('direto');
    expect(near.echoExcess!).toBeGreaterThan(SONAR_EQ.threshold);
  });

  it('canal de superfície: o som chega longe perto da superfície com menos perda que abaixo da camada', () => {
    const res = computeLab(preset('canal'));
    const { cols, rows, loss } = res.field;
    const col = Math.floor(cols * 0.85);
    const at = (z: number) => loss[Math.floor((z / res.depth) * rows) * cols + col];
    expect(at(40)).toBeLessThan(at(300));
    expect(targetStatus(res).tone).toBe('ok');
  });

  it('abaixo da camada (ping de baixo): sombra perto da superfície', () => {
    const res = computeLab(preset('abaixo'));
    expect(res.shadow).not.toBeNull();
    expect(res.shadow!.z).toBeLessThan(res.setup.thermoclineDepth);
    expect(targetStatus(res).tone).toBe('none');
  });

  it('rascunho (menos raios, usado ao arrastar) mostra a mesma zona de sombra', () => {
    const full = computeLab(preset('camada'));
    const draft = computeLab(preset('camada'), 91);
    expect(draft.rays).toHaveLength(91);
    expect(!!draft.shadow).toBe(!!full.shadow);
    expect(Math.abs(draft.shadow!.r - full.shadow!.r)).toBeLessThan(full.setup.range * 0.2);
  });

  it('todos os modelos calculam e o leque tem a densidade esperada', () => {
    for (const p of LAB_PRESETS) {
      const res = computeLab(preset(p.id));
      expect(res.rays).toHaveLength(181);
      expect(res.timeEnd).toBeGreaterThan(0);
      expect(res.profile[0].c).toBeGreaterThan(1400);
    }
  });
});

/**
 * RESOLUÇÃO E DESEMPENHO DA CENA (só visual): escala de resolução da imagem, ajuste automático ("qualidade dinâmica")
 * e medidor de quadros. Não depende de React nem altera a física; as cenas 3D só aplicam o fator de resolução.
 */
import type * as THREE from 'three';

/** escala de resolução escolhida: fração fixa da resolução nativa ou 'auto' (o simulador ajusta sozinho) */
export type RenderScaleSetting = 'auto' | 0.5 | 0.75 | 1;
export const RENDER_SCALE_OPTIONS: RenderScaleSetting[] = ['auto', 1, 0.75, 0.5];
export const RENDER_SCALE_LABELS: Record<string, string> = { auto: 'Automática', '1': '100 %', '0.75': '75 %', '0.5': '50 %' };

export function parseRenderScale(v: unknown, def: RenderScaleSetting): RenderScaleSetting {
  return v === 'auto' || v === 0.5 || v === 0.75 || v === 1 ? v : def;
}

/** degraus do ajuste automático (fração da resolução nativa), do mais leve ao mais nítido */
export const AUTO_STEPS = [0.5, 0.6, 0.75, 0.9, 1];

/** quadro mais lento que isto (ms, média da janela) pede menos resolução; mais rápido que FAST_MS permite subir */
const SLOW_MS = 26;
const FAST_MS = 19;
/** janela de avaliação (ms) e tempo mínimo de folga antes de subir a resolução */
const WINDOW_MS = 1500;
const UP_WAIT_MS = 6000;
const UP_WAIT_MAX_MS = 60000;
/** intervalos maiores que isto (aba oculta, travada) não entram nas médias; aparelhos muito lentos (< 1 fps) ficam sem medida */
const MAX_DT_MS = 2000;

/**
 * Ajuste automático da resolução. Desce um degrau quando a média da janela passa de SLOW_MS e sobe quando fica abaixo de
 * FAST_MS por UP_WAIT_MS. Se descer não melhora o tempo de quadro (limite é a tela ou o navegador, não os pixels), volta
 * ao degrau anterior e não desce de novo por um tempo; se subir força descer logo em seguida, espera mais para tentar outra vez.
 */
export class AdaptiveScale {
  level = AUTO_STEPS.length - 1;
  private sum = 0;
  private n = 0;
  private fastMs = 0;
  private upWait = UP_WAIT_MS;
  private lastUpAt = -Infinity;
  private lastChangeAt = -Infinity;
  private beforeDown: { avg: number; level: number } | null = null;
  private noGainUntil = -Infinity;

  get scale(): number {
    return AUTO_STEPS[this.level];
  }

  /** começa a partir de um nível próximo da escala dada (ao voltar de um valor fixo para o automático) */
  startNear(scale: number): void {
    let best = 0;
    for (let i = 0; i < AUTO_STEPS.length; i++) if (Math.abs(AUTO_STEPS[i] - scale) < Math.abs(AUTO_STEPS[best] - scale)) best = i;
    this.level = best;
    this.reset();
  }

  private reset(): void {
    this.sum = 0;
    this.n = 0;
    this.fastMs = 0;
    this.beforeDown = null;
  }

  /** dt = ms desde o quadro anterior; now = relógio em ms. Devolve true se a escala mudou. */
  update(dt: number, now: number): boolean {
    if (!(dt > 0) || dt > MAX_DT_MS) return false;
    this.sum += dt;
    this.n++;
    if (this.sum < WINDOW_MS) return false;
    const avg = this.sum / this.n;
    const span = this.sum;
    this.sum = 0;
    this.n = 0;
    // a janela logo depois de descer diz se descer adiantou
    if (this.beforeDown) {
      const { avg: before, level } = this.beforeDown;
      this.beforeDown = null;
      if (avg > before * 0.92 && avg > SLOW_MS) {
        this.level = level;
        this.noGainUntil = now + 30000;
        this.fastMs = 0;
        this.lastChangeAt = now;
        return true;
      }
    }
    if (avg > SLOW_MS && this.level > 0 && now >= this.noGainUntil) {
      // subiu há pouco e já está lento: esperar mais para tentar subir outra vez
      if (now - this.lastUpAt < 10000) this.upWait = Math.min(UP_WAIT_MAX_MS, this.upWait * 2);
      this.beforeDown = { avg, level: this.level };
      this.level--;
      this.fastMs = 0;
      this.lastChangeAt = now;
      return true;
    }
    if (avg < FAST_MS && this.level < AUTO_STEPS.length - 1) {
      this.fastMs += span;
      if (this.fastMs >= this.upWait) {
        this.level++;
        this.fastMs = 0;
        this.lastUpAt = now;
        this.lastChangeAt = now;
        return true;
      }
    } else this.fastMs = 0;
    // estável por muito tempo: o prazo de espera volta ao normal
    if (now - this.lastChangeAt > 30000) this.upWait = UP_WAIT_MS;
    return false;
  }
}

/** FPS e tempo de quadro médios, atualizados a cada ~0,5 s */
export class FrameMeter {
  fps = 0;
  ms = 0;
  private sum = 0;
  private n = 0;

  /** acumula um intervalo entre quadros; true quando fps/ms foram atualizados */
  add(dt: number): boolean {
    if (!(dt > 0) || dt > MAX_DT_MS) return false;
    this.sum += dt;
    this.n++;
    if (this.sum < 500) return false;
    this.ms = this.sum / this.n;
    this.fps = 1000 / this.ms;
    this.sum = 0;
    this.n = 0;
    return true;
  }
}

/** Escala + medidor, chamados uma vez por quadro de desenho. */
export class RenderPerf {
  readonly meter = new FrameMeter();
  readonly adaptive = new AdaptiveScale();
  private last = 0;
  private lastSetting: RenderScaleSetting | null = null;
  scale = 1;

  /** devolve a escala de resolução a aplicar neste quadro e diz (updated) se o medidor tem valores novos */
  frame(now: number, setting: RenderScaleSetting): { scale: number; updated: boolean } {
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    const updated = this.meter.add(dt);
    if (setting !== this.lastSetting) {
      if (setting === 'auto') this.adaptive.startNear(this.scale);
      this.lastSetting = setting;
    }
    if (setting === 'auto') {
      this.adaptive.update(dt, now);
      this.scale = this.adaptive.scale;
    } else this.scale = setting;
    return { scale: this.scale, updated };
  }
}

export interface RenderStats {
  /** tamanho do quadro desenhado (pixels) */
  width: number;
  height: number;
  scale: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

/** contadores do renderizador no último quadro (chamadas de desenho, triângulos, memória de GPU) */
export function readRenderStats(r: THREE.WebGLRenderer, scale: number): RenderStats {
  return { width: r.domElement.width, height: r.domElement.height, scale, calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
}

/** texto do medidor, em duas linhas: "60 fps · 16.7 ms · 1280×800 (100 %)" e "120 chamadas · 85 mil triângulos · 90 geom. · 30 tex." */
export function formatPerf(fps: number, ms: number, s: RenderStats, auto: boolean): string {
  const tri = s.triangles >= 1000 ? `${Math.round(s.triangles / 1000)} mil` : String(s.triangles);
  return `${fps.toFixed(0)} fps · ${ms.toFixed(1)} ms · ${s.width}×${s.height} (${Math.round(s.scale * 100)} %${auto ? ' auto' : ''})\n${s.calls} chamadas · ${tri} triângulos · ${s.geometries} geom. · ${s.textures} tex.`;
}

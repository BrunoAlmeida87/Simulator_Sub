import type { PNG } from 'pngjs';

export interface CompareOptions {
  threshold?: number;
  maxDiff?: number;
  maxWindow?: number;
  window?: number;
}
export interface CompareResult {
  total: number;
  ratio: number;
  windowRatio: number;
  diff: PNG;
  pass: boolean;
}
export const DEFAULTS: Required<CompareOptions>;
export function decode(buf: Buffer): PNG;
export function encode(png: PNG): Buffer;
export function downscale2(src: PNG): PNG;
export function blankStats(png: PNG, rect: { x: number; y: number; width: number; height: number }): { std: number; colors: number; blank: boolean };
export function compare(ref: PNG, act: PNG, opts?: CompareOptions, mask?: Uint8Array): CompareResult;

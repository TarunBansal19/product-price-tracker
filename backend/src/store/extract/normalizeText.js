/**
 * extract/normalizeText.js - Pure string normalization per plan §8.2.
 */

const ZERO_WIDTH_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g;

export function normalizeText(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);

  return str
    .normalize('NFKC')
    .replace(ZERO_WIDTH_REGEX, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

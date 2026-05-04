// Pure parser. No DOM, no globals, no side effects.
// This is the integration surface — import { parseTextToList } from './parser.js'

const BULLET_PREFIX = /^\s*(?:[-–—•●○◦▪▫*▶►→»]|(?:\d{1,3}|[a-zA-Z])[.)\]:])\s+/;
const SURROUNDING_QUOTES = /^["'`“”‘’]+|["'`“”‘’]+$/g;
const TRAILING_PUNCT = /[,;]+$/;

function pickDelimiter(text) {
  if (/\r?\n/.test(text)) return /\r?\n+/;
  if (text.includes(';')) return /\s*;\s*/;
  if (text.includes('\t')) return /\t+/;
  if (text.includes(',')) return /\s*,\s*/;
  if (/\s•\s|\s\*\s|\s-\s/.test(text)) return /\s+(?=[•*\-–—])/;
  return null;
}

export function parseTextToList(input, options = {}) {
  if (typeof input !== 'string') return [];
  const text = input.replace(/ /g, ' ').trim();
  if (!text) return [];

  const { dedupe = false } = options;
  const delimiter = pickDelimiter(text);
  const raw = delimiter ? text.split(delimiter) : [text];

  const items = [];
  const seen = new Set();
  for (let part of raw) {
    part = part.trim();
    if (!part) continue;
    part = part.replace(BULLET_PREFIX, '');
    part = part.replace(SURROUNDING_QUOTES, '');
    part = part.replace(TRAILING_PUNCT, '');
    part = part.trim();
    if (!part) continue;
    if (dedupe) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    items.push(part);
  }
  return items;
}

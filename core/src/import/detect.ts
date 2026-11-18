import { looksLikeOfx } from './ofx';
import type { FileKind } from './types';

/** Decide what kind of file the user dropped in. */
export function detectFileKind(fileName: string, text: string): FileKind {
  const name = fileName.toLowerCase();
  if (/\.(ofx|qfx|qbo)$/.test(name) || looksLikeOfx(text)) return 'ofx';
  const head = text.slice(0, 2000).trimStart();
  if (name.endsWith('.json') || head.startsWith('{') || head.startsWith('[')) {
    if (/semanticSegments|timelineObjects|"visit"|"activity"|"timelinePath"|"rawSignals"|"locations"/.test(text.slice(0, 200000))) {
      return 'timeline';
    }
    return 'unknown';
  }
  if (/\.(csv|txt|tsv)$/.test(name) || /,/.test(head.split(/\r?\n/)[0] ?? '')) return 'csv';
  return 'unknown';
}

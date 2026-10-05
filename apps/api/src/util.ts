import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function audit(userId: string | null, action: string, detail?: Prisma.InputJsonValue): Promise<void> {
  await prisma.auditLog.create({ data: { userId, action, detail } }).catch(() => {});
}

/** Natural sort ("2" < "10", "sub1-2" < "sub1-10"). */
export const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

/** Minimal RFC 4180 CSV parser (quoted fields, "" escapes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export function csvEscape(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * REQ-ADM-14 synchronous CSV export helpers.
 * - UTF-8 with BOM so Excel shows Arabic correctly.
 * - RFC 4180 quoting.
 * - Formula-injection guard: cells starting with = + - @ (or tab/CR) are prefixed with '
 *   so a passenger named "=HYPERLINK(...)" cannot execute in a spreadsheet.
 */
import type { Response } from 'express';

export const CSV_MAX_ROWS = 10_000;

const BOM = String.fromCharCode(0xfeff);

export type CsvCell = string | number | boolean | null | undefined | Date;

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))];
  return BOM + `${lines.join('\r\n')}\r\n`;
}

export function csvFilename(base: string, now = new Date()): string {
  return `${base}-${now.toISOString().slice(0, 10)}.csv`;
}

/** Binary (non-envelope) success response — errors still go through the error envelope. */
export function sendCsv(res: Response, csv: string, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

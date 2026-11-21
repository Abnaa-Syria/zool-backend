import { describe, expect, it } from 'vitest';
import { toCsv } from '../../src/shared/http/csv';

describe('toCsv', () => {
  it('starts with a UTF-8 BOM and uses CRLF rows', () => {
    const csv = toCsv(['a', 'b'], [[1, 'x']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('a,b\r\n1,x\r\n');
  });

  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(toCsv(['v'], [['a,b'], ['say "hi"'], ['l1\nl2']]).slice(1)).toBe('v\r\n"a,b"\r\n"say ""hi"""\r\n"l1\nl2"\r\n');
  });

  it('neutralises spreadsheet formulas in text cells but keeps negative numbers', () => {
    const csv = toCsv(['v'], [['=HYPERLINK("http://x")'], ['+1'], ['@cmd'], [-500]]).slice(1);
    expect(csv).toBe('v\r\n"\'=HYPERLINK(""http://x"")"\r\n\'+1\r\n\'@cmd\r\n-500\r\n');
  });

  it('renders dates as ISO and empty values as blank', () => {
    expect(toCsv(['d', 'n'], [[new Date('2026-11-22T06:00:00.000Z'), null]]).slice(1)).toBe('d,n\r\n2026-11-22T06:00:00.000Z,\r\n');
  });
});

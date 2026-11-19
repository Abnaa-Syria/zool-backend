import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../src');

const APPROVED_JSON_SERIALIZERS = new Set([
  path.normalize('shared/http/success-response.ts'),
  path.normalize('shared/middleware/error-handler.ts'),
  // OpenAPI document delivery only — not business API envelopes
  path.normalize('app.ts'),
]);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function rel(file: string): string {
  return path.normalize(path.relative(root, file));
}

function isServiceOrRepository(file: string): boolean {
  const name = path.basename(file);
  return name.endsWith('.service.ts') || name.endsWith('.repository.ts');
}

describe('HTTP contract architecture', () => {
  const files = walk(root);

  it('restricts direct res.json / res.status().json to approved serializers', () => {
    const violations: string[] = [];
    const jsonCall =
      /\bres\.json\s*\(|\bres\.status\s*\([^)]*\)\s*\.json\s*\(/g;

    for (const file of files) {
      const relative = rel(file);
      if (APPROVED_JSON_SERIALIZERS.has(relative)) continue;
      // Cookie helpers may set cookies but must not serialize JSON bodies
      const source = readFileSync(file, 'utf8');
      if (jsonCall.test(source)) {
        violations.push(relative);
      }
      jsonCall.lastIndex = 0;
    }

    expect(violations, `Direct JSON serialization outside approved files:\n${violations.join('\n')}`).toEqual(
      [],
    );
  });

  it('forbids Express imports in services and repositories', () => {
    const violations: string[] = [];
    const expressImport = /from\s+['"]express['"]|require\(\s*['"]express['"]\s*\)/;

    for (const file of files) {
      if (!isServiceOrRepository(file)) continue;
      const source = readFileSync(file, 'utf8');
      if (expressImport.test(source)) {
        violations.push(rel(file));
      }
    }

    expect(violations, `Express imported in service/repository:\n${violations.join('\n')}`).toEqual([]);
  });

  it('forbids HTTP success/error envelopes returned from services', () => {
    const violations: string[] = [];
    const envelope = /success:\s*(true|false)/;

    for (const file of files) {
      if (!file.endsWith('.service.ts')) continue;
      const source = readFileSync(file, 'utf8');
      // Allow comments mentioning the pattern
      const codeLines = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'));
      if (codeLines.some((line) => envelope.test(line))) {
        violations.push(rel(file));
      }
    }

    expect(violations, `Service returns HTTP envelope fields:\n${violations.join('\n')}`).toEqual([]);
  });

  it('forbids repetitive controller try/catch used only for error responses', () => {
    const violations: string[] = [];

    for (const file of files) {
      if (!file.endsWith('.controller.ts')) continue;
      const source = readFileSync(file, 'utf8');
      if (/catch\s*\([^)]*\)\s*\{[\s\S]*?res\.(status|json)/m.test(source)) {
        violations.push(rel(file));
      }
    }

    expect(violations).toEqual([]);
  });
});

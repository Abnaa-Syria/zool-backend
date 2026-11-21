import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { createApp } from '../../src/app';

/**
 * The published contract (docs/openapi.yaml) must list exactly the routes the app serves.
 * Add or change a route → update openapi.yaml in the same PR (API_CONVENTIONS §13).
 */

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  regexp?: RegExp;
  handle?: { stack?: Layer[] };
};

function mountPath(layer: Layer): string {
  if (!layer.regexp) return '';
  let src = layer.regexp.source;
  if (src === '^\\/?(?=\\/|$)') return '';
  src = src
    .replace(/^\^/, '')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/\\\//g, '/');
  return src;
}

function collectRoutes(stack: Layer[], prefix: string, out: Set<string>): void {
  for (const layer of stack) {
    if (layer.route) {
      const full = (prefix + (layer.route.path === '/' ? '' : layer.route.path)) || '/';
      for (const m of Object.keys(layer.route.methods)) {
        if ((HTTP_METHODS as readonly string[]).includes(m)) out.add(`${m.toUpperCase()} ${full}`);
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      collectRoutes(layer.handle.stack, prefix + mountPath(layer), out);
    }
  }
}

function appRoutes(app: Express): Set<string> {
  const out = new Set<string>();
  const stack = (app as unknown as { _router: { stack: Layer[] } })._router.stack;
  collectRoutes(stack, '', out);
  const prefix = process.env.API_PREFIX ?? '/api/v1';
  return new Set(
    [...out]
      .filter((r) => r.split(' ')[1]!.startsWith(prefix))
      .map((r) => {
        const [method, p] = r.split(' ') as [string, string];
        return `${method} ${p.slice(prefix.length).replace(/:([A-Za-z0-9_]+)/g, '{$1}') || '/'}`;
      }),
  );
}

function specRoutes(): Set<string> {
  const doc = YAML.parse(readFileSync(path.join(process.cwd(), 'docs', 'openapi.yaml'), 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const out = new Set<string>();
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const m of HTTP_METHODS) if (item[m]) out.add(`${m.toUpperCase()} ${p}`);
  }
  return out;
}

/** Path params may be named differently in code and spec; compare by shape. */
const shape = (r: string) => r.replace(/\{[^}]+\}/g, '{}');

describe('OpenAPI parity', () => {
  resetEnvCache();
  loadEnv(process.env);
  const app = createApp();
  const served = appRoutes(app);
  const documented = specRoutes();
  const servedShapes = new Set([...served].map(shape));
  const documentedShapes = new Set([...documented].map(shape));

  it('actually discovers the app routes (guards against a silent empty comparison)', () => {
    expect(served.size).toBeGreaterThan(60);
    expect(served.has('POST /broker/bookings/confirm')).toBe(true);
    expect(served.has('GET /admin/bookings/{id}')).toBe(true);
  });

  it('every served route is documented in docs/openapi.yaml', () => {
    const missing = [...served].filter((r) => !documentedShapes.has(shape(r))).sort();
    expect(missing, `Undocumented routes:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every documented route is served', () => {
    const stale = [...documented].filter((r) => !servedShapes.has(shape(r))).sort();
    expect(stale, `Documented but not served:\n${stale.join('\n')}`).toEqual([]);
  });
});

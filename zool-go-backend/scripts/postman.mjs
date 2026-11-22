// `npm run docs:postman` — builds docs/postman/*.json from docs/openapi.yaml.
// One folder per OpenAPI tag, a "0 · Login" folder that stores tokens for each app, and
// bearer auth picked from each operation's security scheme.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const spec = YAML.parse(readFileSync(path.join(root, 'docs', 'openapi.yaml'), 'utf8'));

const TOKEN_BY_SCHEME = {
  bearerAuth: 'adminToken',
  brokerBearerAuth: 'brokerToken',
  customerBearerAuth: 'customerToken',
  driverBearerAuth: 'driverToken',
};

const mobileHeader = { key: 'X-Client-Platform', value: 'android' };

function url(p) {
  const pathPart = p.replace(/\{(\w+)\}/g, ':$1');
  const vars = [...p.matchAll(/\{(\w+)\}/g)].map((m) => ({ key: m[1], value: '' }));
  return { raw: `{{baseUrl}}${pathPart}`, host: ['{{baseUrl}}'], path: pathPart.split('/').filter(Boolean), variable: vars };
}

function login(name, base, phoneVar, tokenVar, refreshVar) {
  const save = (lines) => ({ listen: 'test', script: { type: 'text/javascript', exec: lines } });
  return {
    name,
    item: [
      {
        name: `${name}: request code`,
        event: [save([
          'const d = pm.response.json().data;',
          "pm.collectionVariables.set('challengeId', d.challengeId);",
          "pm.collectionVariables.set('devOtp', d.devOtp || '');",
        ])],
        request: {
          method: 'POST',
          header: [{ key: 'Content-Type', value: 'application/json' }],
          url: url(`${base}/otp/request`),
          body: { mode: 'raw', raw: JSON.stringify({ phone: `{{${phoneVar}}}` }, null, 2) },
        },
      },
      {
        name: `${name}: verify code (saves token)`,
        event: [save([
          'const d = pm.response.json().data;',
          `pm.collectionVariables.set('${tokenVar}', d.accessToken);`,
          refreshVar ? `if (d.refreshToken) pm.collectionVariables.set('${refreshVar}', d.refreshToken);` : '',
        ].filter(Boolean))],
        request: {
          method: 'POST',
          header: [{ key: 'Content-Type', value: 'application/json' }, ...(refreshVar ? [mobileHeader] : [])],
          url: url(`${base}/otp/verify`),
          body: { mode: 'raw', raw: JSON.stringify({ phone: `{{${phoneVar}}}`, code: '{{devOtp}}', challengeId: '{{challengeId}}' }, null, 2) },
        },
      },
    ],
  };
}

const folders = new Map();
for (const [p, ops] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(ops)) {
    const tag = op.tags?.[0] ?? 'Other';
    const scheme = op.security?.[0] ? Object.keys(op.security[0])[0] : null;
    const headers = [];
    if (op.requestBody) headers.push({ key: 'Content-Type', value: 'application/json' });
    if ((op.parameters ?? []).some((x) => x.name === 'Idempotency-Key')) headers.push({ key: 'Idempotency-Key', value: '{{$guid}}' });
    if (scheme === 'customerBearerAuth' || scheme === 'driverBearerAuth' || p.startsWith('/customer/auth') || p.startsWith('/driver/auth')) headers.push(mobileHeader);
    const query = (op.parameters ?? []).filter((x) => x.in === 'query').map((x) => ({ key: x.name, value: '', disabled: true, description: x.description ?? '' }));
    const u = url(p);
    if (query.length) u.query = query;
    const item = {
      name: `${method.toUpperCase()} ${p}`,
      request: {
        method: method.toUpperCase(),
        description: op.summary ?? '',
        header: headers,
        url: u,
        ...(scheme ? { auth: { type: 'bearer', bearer: [{ key: 'token', value: `{{${TOKEN_BY_SCHEME[scheme]}}}`, type: 'string' }] } } : { auth: { type: 'noauth' } }),
        ...(op.requestBody ? { body: { mode: 'raw', raw: '{\n  \n}', options: { raw: { language: 'json' } } } } : {}),
      },
    };
    if (!folders.has(tag)) folders.set(tag, []);
    folders.get(tag).push(item);
  }
}

const collection = {
  info: {
    name: 'ZoolGo API v1',
    description: 'Generated from docs/openapi.yaml (npm run docs:postman). Start with "0 · Login": request a code, then verify — dev servers return devOtp, so no SMS is needed. Rules: docs/API_CONVENTIONS.md.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    {
      name: '0 · Login (dev OTP)',
      item: [
        login('Admin', '/auth', 'adminPhone', 'adminToken'),
        login('Broker', '/broker/auth', 'brokerPhone', 'brokerToken', 'brokerRefreshToken'),
        login('Customer', '/customer/auth', 'customerPhone', 'customerToken', 'customerRefreshToken'),
        login('Driver', '/driver/auth', 'driverPhone', 'driverToken', 'driverRefreshToken'),
      ],
    },
    ...[...folders.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => ({ name, item })),
  ],
  variable: [
    { key: 'baseUrl', value: 'http://localhost:4000/api/v1' },
    { key: 'adminPhone', value: '+249900000001' },
    { key: 'brokerPhone', value: '+249900000101' },
    { key: 'customerPhone', value: '+249900000301' },
    { key: 'driverPhone', value: '+249900000201' },
    ...['adminToken', 'brokerToken', 'customerToken', 'driverToken', 'brokerRefreshToken', 'customerRefreshToken', 'driverRefreshToken', 'challengeId', 'devOtp'].map((key) => ({ key, value: '' })),
  ],
};

const out = path.join(root, 'docs', 'postman');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'ZoolGo.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');
const count = [...folders.values()].reduce((n, f) => n + f.length, 0);
console.log(`Postman collection: ${count} requests in ${folders.size} folders -> docs/postman/ZoolGo.postman_collection.json`);

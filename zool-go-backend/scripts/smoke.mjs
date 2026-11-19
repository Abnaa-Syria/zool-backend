const base = 'http://127.0.0.1:4000/api/v1';

function show(label, body) {
  console.log(label, JSON.stringify(body, null, 2));
}

async function main() {
  const health = await fetch(`${base}/health`).then((r) => r.json());
  show('SUCCESS health', health);

  const ready = await fetch(`${base}/ready`).then((r) => r.json());
  console.log('ready', ready.data?.status, ready.data?.checks);

  const otpReq = await fetch(`${base}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'smoke-otp-1' },
    body: JSON.stringify({ phone: '+249900000001' }),
  }).then((r) => r.json());

  if (!otpReq.success) {
    console.error('otp request failed', otpReq);
    process.exit(1);
  }
  console.log('devOtp received', Boolean(otpReq.data.devOtp));

  const verifyRes = await fetch(`${base}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+249900000001', code: otpReq.data.devOtp }),
  });
  const setCookie = verifyRes.headers.getSetCookie?.() ?? [];
  const verify = await verifyRes.json();
  if (!verify.success) {
    console.error('verify failed', verify);
    process.exit(1);
  }
  const token = verify.data.accessToken;
  console.log('accessToken length', token.length);
  console.log('refresh cookie set', setCookie.some((c) => c.startsWith('zoolgo_refresh=')));

  const me = await fetch(`${base}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  console.log('me permissions', me.data.permissions.length);

  const unauthorized = await fetch(`${base}/roles`).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));
  show('AUTH_ERROR unauthorized roles', unauthorized.body);

  const roles = await fetch(`${base}/roles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('roles with auth', roles.status);

  const validation = await fetch(`${base}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'smoke-val-1' },
    body: JSON.stringify({}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  show('VALIDATION_ERROR', validation.body);

  const unknown = await fetch(`${base}/nope`).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));
  show('NOT_FOUND route', unknown.body);

  const cookie = setCookie.find((c) => c.startsWith('zoolgo_refresh='))?.split(';')[0];
  const refresh = await fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  }).then((r) => r.json());
  console.log('refresh ok', Boolean(refresh.data?.accessToken));

  const logout = await fetch(`${base}/auth/logout`, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  }).then((r) => r.json());
  console.log('logout', logout.success);

  console.log('SMOKE_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

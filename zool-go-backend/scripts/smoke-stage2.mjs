/**
 * Stage 2 smoke test for the broker path against a running dev server.
 * Prereqs: `npm run db:seed` (office ZG-BRK-1, manager +249900000101, tomorrow trips)
 * and `npm run dev` (NODE_ENV=development with OTP_DEV_EXPOSE=true, PAYMENT_PROVIDER=mock).
 *
 * Usage: node scripts/smoke-stage2.mjs
 */
const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4000/api/v1';
const MANAGER_PHONE = process.env.SMOKE_BROKER_PHONE ?? '+249900000101';
const ADMIN_PHONE = process.env.SMOKE_ADMIN_PHONE ?? '+249900000001';

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, res };
}

async function callBinary(method, path, { token } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, contentType: res.headers.get('content-type') };
}

function expect(label, cond, detail) {
  if (!cond) {
    console.error(`FAIL ${label}`, detail ? JSON.stringify(detail, null, 2) : '');
    process.exit(1);
  }
  console.log(`ok   ${label}`);
}

async function main() {
  const otp = await call('POST', '/broker/auth/otp/request', { body: { phone: MANAGER_PHONE } });
  expect('broker otp request', otp.status === 200 && otp.json.data?.devOtp, otp.json);

  const verify = await call('POST', '/broker/auth/otp/verify', {
    body: { phone: MANAGER_PHONE, code: otp.json.data.devOtp, challengeId: otp.json.data.challengeId },
  });
  expect('broker otp verify', verify.status === 200, verify.json);
  const token = verify.json.data.accessToken;
  const cookies = verify.res.headers.getSetCookie?.() ?? [];
  expect(
    'broker refresh cookie set',
    cookies.some((c) => c.startsWith('zoolgo_broker_refresh=')),
  );

  const me = await call('GET', '/broker/auth/me', { token });
  expect('broker me', me.status === 200 && me.json.data.role === 'MANAGER', me.json);

  const topUp = await call('POST', '/broker/wallet/top-ups', {
    token,
    body: { amountMinor: 100000, idempotencyKey: `smoke-topup-${Date.now()}` },
  });
  expect('create top-up', topUp.status === 201, topUp.json);

  const confirm = await call('POST', `/broker/wallet/top-ups/${topUp.json.data.id}/mock-confirm`, { token });
  expect('mock confirm top-up', confirm.status === 200, confirm.json);
  console.log('     balanceMinor:', confirm.json.data.balanceMinor);

  const trips = await call('GET', '/broker/trips', { token });
  expect('search trips', trips.status === 200 && trips.json.data.length > 0, trips.json);
  const trip = trips.json.data[0];
  console.log(`     trip ${trip.origin} -> ${trip.destination} @ ${trip.basePrice}, commission ${trip.commissionPercent}%`);

  const detail = await call('GET', `/broker/trips/${trip.id}`, { token });
  const free = detail.json.data.seats.find((s) => s.status === 'FREE');
  expect('free seat available', Boolean(free), detail.json);

  const hold = await call('POST', `/broker/trips/${trip.id}/holds`, { token, body: { seatIds: [free.id] } });
  expect('hold seat', hold.status === 201, hold.json);

  const passengers = [{ fullName: 'Smoke Passenger', phone: '0911111111' }];
  const quote = await call('POST', '/broker/bookings/quote', {
    token,
    body: { tripId: trip.id, seatIds: [free.id], passengers },
  });
  expect('quote', quote.status === 200, quote.json);
  console.log('     quote:', JSON.stringify(quote.json.data));

  const booking = await call('POST', '/broker/bookings/confirm', {
    token,
    body: { tripId: trip.id, seatIds: [free.id], passengers, idempotencyKey: `smoke-booking-${Date.now()}` },
  });
  expect('confirm booking', booking.status === 201, booking.json);
  const bookingId = booking.json.data.booking.id;

  const dispatch = await call('POST', `/broker/bookings/${bookingId}/dispatch`, {
    token,
    body: { channel: 'download' },
  });
  expect(
    'dispatch PDF',
    dispatch.status === 200 &&
      dispatch.json.data?.status === 'READY' &&
      typeof dispatch.json.data?.pdfBase64 === 'string' &&
      dispatch.json.data.pdfBase64.startsWith('JVBERi'),
    dispatch.json,
  );

  const ticketNumber = booking.json.data.booking.tickets[0]?.ticketNumber;
  expect('ticket number present', Boolean(ticketNumber), booking.json);
  const pdf = await callBinary('GET', `/broker/bookings/${bookingId}/tickets/${ticketNumber}/pdf`, { token });
  expect(
    'ticket pdf binary',
    pdf.status === 200 && pdf.contentType?.includes('pdf') && pdf.buf.subarray(0, 5).toString() === '%PDF-',
    { status: pdf.status, contentType: pdf.contentType },
  );

  const summary = await call('GET', '/broker/reports/summary', { token });
  expect('reports summary', summary.status === 200 && summary.json.data.ticketsSold >= 1, summary.json);

  const officeId = me.json.data.office.id;
  const adminOtp = await call('POST', '/auth/otp/request', { body: { phone: ADMIN_PHONE } });
  expect('admin otp request', adminOtp.status === 200 && adminOtp.json.data?.devOtp, adminOtp.json);
  const adminVerify = await call('POST', '/auth/otp/verify', {
    body: {
      phone: ADMIN_PHONE,
      code: adminOtp.json.data.devOtp,
      challengeId: adminOtp.json.data.challengeId,
    },
  });
  expect('admin otp verify', adminVerify.status === 200, adminVerify.json);
  const adminToken = adminVerify.json.data.accessToken;

  const wallets = await call('GET', '/admin/wallets?page=1&pageSize=20&sort=balanceMinor&order=desc', {
    token: adminToken,
  });
  expect(
    'admin wallet list',
    wallets.status === 200 &&
      Array.isArray(wallets.json.data) &&
      wallets.json.data.some((w) => w.officeId === officeId && w.currency === 'SDG'),
    wallets.json,
  );

  const carriers = await call('GET', '/carriers?pageSize=20', { token: adminToken });
  expect('list carriers', carriers.status === 200 && carriers.json.data.length > 0, carriers.json);
  const carrier = carriers.json.data[0];
  const originalName = carrier.name;

  const carrierDetail = await call('GET', `/carriers/${carrier.id}`, { token: adminToken });
  expect(
    'carrier detail',
    carrierDetail.status === 200 &&
      carrierDetail.json.data.id === carrier.id &&
      typeof carrierDetail.json.data.assignmentCount === 'number',
    carrierDetail.json,
  );

  const patched = await call('PATCH', `/carriers/${carrier.id}`, {
    token: adminToken,
    body: { name: `${originalName} smoke` },
  });
  expect('carrier patch', patched.status === 200 && patched.json.data.name === `${originalName} smoke`, patched.json);
  const restored = await call('PATCH', `/carriers/${carrier.id}`, {
    token: adminToken,
    body: { name: originalName },
  });
  expect('carrier restore', restored.status === 200 && restored.json.data.name === originalName, restored.json);

  const carrierSearch = await call('GET', `/carriers?q=${encodeURIComponent(carrier.key)}`, {
    token: adminToken,
  });
  expect(
    'carrier search',
    carrierSearch.status === 200 && carrierSearch.json.data.some((c) => c.id === carrier.id),
    carrierSearch.json,
  );

  const audits = await call('GET', '/audit-logs?action=carrier.updated&pageSize=20', { token: adminToken });
  expect('audit filters', audits.status === 200 && Array.isArray(audits.json.data), audits.json);

  const adminMe = adminVerify.json.data.admin;
  const originalAdminName = adminMe.displayName;
  const renamedAdmin = await call('PATCH', `/admins/${adminMe.id}`, {
    token: adminToken,
    body: { displayName: `${originalAdminName} smoke` },
  });
  expect(
    'admin profile patch',
    renamedAdmin.status === 200 && renamedAdmin.json.data.displayName === `${originalAdminName} smoke`,
    renamedAdmin.json,
  );
  const restoredAdmin = await call('PATCH', `/admins/${adminMe.id}`, {
    token: adminToken,
    body: { displayName: originalAdminName },
  });
  expect(
    'admin profile restore',
    restoredAdmin.status === 200 && restoredAdmin.json.data.displayName === originalAdminName,
    restoredAdmin.json,
  );

  const officeDetail = await call('GET', `/brokers/${officeId}`, { token: adminToken });
  const clerk = officeDetail.json.data.employees?.find((e) => e.role === 'CLERK');
  expect('seed clerk present', Boolean(clerk), officeDetail.json);
  const originalClerkName = clerk.displayName;
  const patchedClerk = await call('PATCH', `/brokers/${officeId}/staff/${clerk.id}`, {
    token: adminToken,
    body: { displayName: `${originalClerkName} smoke` },
  });
  expect(
    'office staff patch',
    patchedClerk.status === 200 && patchedClerk.json.data.displayName === `${originalClerkName} smoke`,
    patchedClerk.json,
  );
  const restoredClerk = await call('PATCH', `/brokers/${officeId}/staff/${clerk.id}`, {
    token: adminToken,
    body: { displayName: originalClerkName },
  });
  expect(
    'office staff restore',
    restoredClerk.status === 200 && restoredClerk.json.data.displayName === originalClerkName,
    restoredClerk.json,
  );

  const adminTrip = await call('GET', `/catalog/trips/${trip.id}`, { token: adminToken });
  expect(
    'admin trip detail',
    adminTrip.status === 200 &&
      adminTrip.json.data.id === trip.id &&
      Array.isArray(adminTrip.json.data.seats) &&
      adminTrip.json.data.seats.every((s) => s.holdId === undefined && s.heldByMe === undefined),
    adminTrip.json,
  );

  const adminPdf = await callBinary(
    'GET',
    `/admin/bookings/${bookingId}/tickets/${ticketNumber}/pdf`,
    { token: adminToken },
  );
  expect(
    'admin ticket pdf',
    adminPdf.status === 200 &&
      adminPdf.contentType?.includes('pdf') &&
      adminPdf.buf.subarray(0, 5).toString() === '%PDF-',
    { status: adminPdf.status, contentType: adminPdf.contentType },
  );

  const bookingSearch = await call('GET', `/admin/bookings?q=${encodeURIComponent(ticketNumber)}`, {
    token: adminToken,
  });
  expect(
    'admin booking search',
    bookingSearch.status === 200 &&
      bookingSearch.json.data.some((b) => b.id === bookingId && b.status === 'CONFIRMED'),
    bookingSearch.json,
  );

  const periodFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const periodTo = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const draft = await call('POST', '/admin/commissions/settlements', {
    token: adminToken,
    body: { officeId, periodFrom, periodTo, note: 'smoke-milestone-a' },
  });
  expect('settlement draft', draft.status === 201 && draft.json.data.status === 'DRAFT', draft.json);
  const settlementId = draft.json.data.id;
  const accruals = await call('GET', `/admin/commissions/settlements/${settlementId}/accruals`, {
    token: adminToken,
  });
  expect(
    'settlement accruals',
    accruals.status === 200 &&
      Array.isArray(accruals.json.data) &&
      accruals.json.data.reduce((sum, row) => sum + row.amountMinor, 0) === draft.json.data.totalAmountMinor,
    accruals.json,
  );
  const cancelledSettlement = await call('POST', `/admin/commissions/settlements/${settlementId}/cancel`, {
    token: adminToken,
  });
  expect(
    'settlement cancel restore',
    cancelledSettlement.status === 200 && cancelledSettlement.json.data.status === 'CANCELLED',
    cancelledSettlement.json,
  );

  const cancel = await call('POST', `/broker/bookings/${bookingId}/cancel`, { token });
  expect('cancel booking', cancel.status === 200 && cancel.json.data.refundedAmountMinor > 0, cancel.json);

  const refresh = await call('POST', '/broker/auth/refresh', {
    headers: { Cookie: cookies.map((c) => c.split(';')[0]).join('; ') },
  });
  expect('broker refresh', refresh.status === 200, refresh.json);

  console.log('SMOKE_STAGE2_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

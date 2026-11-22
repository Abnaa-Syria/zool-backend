import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../../src/config/env';
import { otpCodeFor } from '../../src/shared/security/crypto';

const base = {
  DATABASE_URL: 'mysql://u:p@localhost:3306/x',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  CORS_ORIGINS: 'http://localhost',
  OTP_HMAC_SECRET: 'b'.repeat(40),
};

describe('OTP_FIXED_CODES (staging and store-review accounts)', () => {
  afterAll(() => {
    resetEnvCache();
    loadEnv(process.env);
  });

  it('returns the fixed code for listed phones and prefixes, random otherwise', () => {
    resetEnvCache();
    loadEnv({ ...base, OTP_FIXED_CODES: '+249900000001:482913,+2499000003*:771204' });
    expect(otpCodeFor('+249900000001')).toBe('482913');
    expect(otpCodeFor('+249900000355')).toBe('771204');
    const random = otpCodeFor('+249912345678');
    expect(random).toMatch(/^\d{6}$/);
  });

  it('rejects malformed entries at startup', () => {
    resetEnvCache();
    expect(() => loadEnv({ ...base, OTP_FIXED_CODES: '+249900000001:12' })).toThrow(/OTP_FIXED_CODES/);
  });
});

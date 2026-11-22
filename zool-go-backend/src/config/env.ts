import { z } from 'zod';

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_NAME: z.string().min(1).default('zool-go-backend'),
    API_PREFIX: z.string().min(1).default('/api/v1'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    REDIS_KEY_PREFIX: z.string().default('zoolgo:'),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),

    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
    REFRESH_COOKIE_NAME: z.string().min(1).default('zoolgo_refresh'),
    REFRESH_COOKIE_SECURE: booleanFromString.default(false),
    REFRESH_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    REFRESH_COOKIE_DOMAIN: z.string().optional().default(''),
    REFRESH_COOKIE_PATH: z.string().min(1).default('/api/v1/auth'),

    CORS_ORIGINS: z.string().min(1),
    TRUST_PROXY: booleanFromString.default(false),

    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
    OTP_HMAC_SECRET: z.string().min(32),
    OTP_DEV_EXPOSE: booleanFromString.default(false),
    /**
     * Staging/test accounts and store-review accounts: fixed login codes, no SMS needed.
     * "+249900000001:482913,+2499000003*:771204" (a trailing * matches a phone prefix).
     * Keep the codes secret; remove the list at public launch.
     */
    OTP_FIXED_CODES: z.string().optional().default(''),
    OTP_REQUEST_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
    OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(600),
    OTP_VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(600),

    BOOTSTRAP_SUPER_ADMIN_PHONE: z.string().min(8).default('+249900000001'),
    BOOTSTRAP_SUPER_ADMIN_DISPLAY_NAME: z.string().min(1).default('Super Admin'),
    BOOTSTRAP_SUPER_ADMIN_EMPLOYEE_CODE: z.string().min(1).default('ZG-EMP-BOOTSTRAP'),

    // Stage 2 — broker vertical (PDF §7 placeholders + mock payment)
    MIN_TOP_UP_AMOUNT: z.coerce.number().int().positive().default(10000),
    DEFAULT_BOOKING_EXPOSURE_CEILING: z.coerce.number().int().positive().default(100),
    DEFAULT_SETTLEMENT_PERIOD: z.enum(['WEEKLY', 'MONTHLY']).default('MONTHLY'),
    SEAT_HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
    /** Staging only: allow the mock provider's confirm endpoints while NODE_ENV=production. */
    PAYMENT_MOCK_IN_PRODUCTION: booleanFromString.default(false),
    /** Dev/staging: keep the demo carrier scheduled this many days ahead (0 = off). */
    DEMO_SCHEDULE_DAYS: z.coerce.number().int().min(0).max(60).default(0),
    PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('change-me-payment-webhook-secret'),
    PAYMENT_WEBHOOK_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(300),
    PLATFORM_TIMEZONE: z.string().min(1).default('Africa/Khartoum'),
    UPLOAD_DIR: z.string().min(1).default('./uploads'),
    BROKER_REFRESH_COOKIE_NAME: z.string().min(1).default('zoolgo_broker_refresh'),
    BROKER_REFRESH_COOKIE_PATH: z.string().min(1).default('/api/v1/broker/auth'),
    CARRIER_REFRESH_COOKIE_NAME: z.string().min(1).default('zoolgo_carrier_refresh'),
    CARRIER_REFRESH_COOKIE_PATH: z.string().min(1).default('/api/v1/carrier/auth'),
    LOW_BALANCE_WARNING_THRESHOLD: z.coerce.number().int().nonnegative().default(20000),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((data, ctx) => {
    for (const entry of data.OTP_FIXED_CODES.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [phone, code] = entry.split(':');
      if (!phone || !/^\+\d{6,15}\*?$/.test(phone) || !code || !new RegExp(`^\\d{${data.OTP_LENGTH}}$`).test(code)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['OTP_FIXED_CODES'], message: `Invalid entry "${entry}" (expected +2499xxxxxxx[*]:${'9'.repeat(data.OTP_LENGTH)})` });
      }
    }

    if (data.NODE_ENV === 'production' && data.OTP_DEV_EXPOSE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_DEV_EXPOSE'],
        message: 'OTP_DEV_EXPOSE must be false in production',
      });
    }

    if (data.REFRESH_COOKIE_SAMESITE === 'none' && !data.REFRESH_COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REFRESH_COOKIE_SECURE'],
        message: 'REFRESH_COOKIE_SECURE must be true when SameSite=None',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  cachedEnv = parsed.data;
  return parsed.data;
}

export function env(): Env {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}

export function corsOrigins(value = env().CORS_ORIGINS): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

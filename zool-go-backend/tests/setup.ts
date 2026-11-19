import { config as loadDotenv } from 'dotenv';
import path from 'path';

// Prefer .env.test when present; tests also set DATABASE_URL explicitly in helpers.
loadDotenv({ path: path.join(process.cwd(), '.env.test') });
loadDotenv({ path: path.join(process.cwd(), '.env') });

process.env.NODE_ENV = 'test';
process.env.OTP_DEV_EXPOSE = 'true';
process.env.LOG_LEVEL = 'silent';

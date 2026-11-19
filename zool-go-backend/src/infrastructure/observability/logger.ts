import pino from 'pino';

export const logger = pino({
  name: process.env.APP_NAME ?? 'zool-go-backend',
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      'password',
      'secret',
      'token',
      'refreshToken',
      'accessToken',
      'otp',
      'devOtp',
      'code',
      'codeHash',
      'tokenHash',
      '*.password',
      '*.secret',
      '*.token',
      '*.otp',
      '*.devOtp',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[REDACTED]',
  },
});

import { ErrorCodes, type ErrorCode } from './error-codes';

export type AppErrorParams = {
  message: string;
  statusCode: number;
  code: ErrorCode;
  details?: unknown;
  isOperational?: boolean;
  cause?: unknown;
};

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(params: AppErrorParams);
  /** @deprecated Prefer object constructor. Kept for transitional call sites. */
  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: unknown,
    options?: { isOperational?: boolean; cause?: unknown },
  );
  constructor(
    statusCodeOrParams: number | AppErrorParams,
    code?: ErrorCode,
    message?: string,
    details?: unknown,
    options?: { isOperational?: boolean; cause?: unknown },
  ) {
    if (typeof statusCodeOrParams === 'object') {
      const opts = statusCodeOrParams;
      super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
      this.name = new.target.name;
      this.statusCode = opts.statusCode;
      this.code = opts.code;
      this.details = opts.details;
      this.isOperational = opts.isOperational ?? true;
    } else {
      super(message ?? 'Error', options?.cause !== undefined ? { cause: options.cause } : undefined);
      this.name = new.target.name;
      this.statusCode = statusCodeOrParams;
      this.code = code ?? ErrorCodes.INTERNAL_SERVER_ERROR;
      this.details = details;
      this.isOperational = options?.isOperational ?? true;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static validation(message = 'Request validation failed', details?: unknown): AppError {
    return new ValidationError({ message, details });
  }

  static unauthorized(
    message = 'Authentication is required',
    options?: { code?: ErrorCode; details?: unknown },
  ): AppError {
    return new AuthenticationError({
      message,
      code: options?.code ?? ErrorCodes.AUTHENTICATION_REQUIRED,
      details: options?.details,
    });
  }

  static forbidden(message = 'You do not have permission to perform this action', details?: unknown): AppError {
    return new PermissionDeniedError({ message, details });
  }

  static notFound(message = 'Resource was not found', details?: unknown): AppError {
    return new NotFoundError({ message, details });
  }

  static conflict(message = 'Conflict', details?: unknown): AppError {
    return new ConflictError({ message, details });
  }

  static rateLimit(message = 'Too many requests', details?: unknown): AppError {
    return new RateLimitError({ message, details });
  }

  static rateLimited(message = 'Too many requests', details?: unknown): AppError {
    return AppError.rateLimit(message, details);
  }

  static internal(message = 'Internal server error', details?: unknown): AppError {
    return new InternalServerError({ message, details });
  }
}

export class ValidationError extends AppError {
  constructor(params: { message?: string; code?: ErrorCode; details?: unknown }) {
    super({
      statusCode: 422,
      code: params.code ?? ErrorCodes.VALIDATION_ERROR,
      message: params.message ?? 'Request validation failed',
      details: params.details,
    });
  }
}

export class MalformedJsonError extends AppError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      statusCode: 400,
      code: ErrorCodes.MALFORMED_JSON,
      message: params?.message ?? 'Malformed JSON request body',
      details: params?.details,
    });
  }
}

export class AuthenticationError extends AppError {
  constructor(params?: { message?: string; code?: ErrorCode; details?: unknown }) {
    super({
      statusCode: 401,
      code: params?.code ?? ErrorCodes.AUTHENTICATION_REQUIRED,
      message: params?.message ?? 'Authentication is required',
      details: params?.details,
    });
  }
}

export class InvalidCredentialsError extends AuthenticationError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      code: ErrorCodes.INVALID_CREDENTIALS,
      message: params?.message ?? 'Invalid credentials',
      details: params?.details,
    });
  }
}

export class OtpInvalidError extends AuthenticationError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      code: ErrorCodes.OTP_INVALID,
      message: params?.message ?? 'Invalid OTP',
      details: params?.details,
    });
  }
}

export class OtpExpiredError extends AuthenticationError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      code: ErrorCodes.OTP_EXPIRED,
      message: params?.message ?? 'OTP expired',
      details: params?.details,
    });
  }
}

export class OtpAttemptLimitError extends AuthenticationError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      code: ErrorCodes.OTP_LOCKED,
      message: params?.message ?? 'OTP challenge locked due to too many attempts',
      details: params?.details,
    });
  }
}

export class AuthorizationError extends AppError {
  constructor(params?: { message?: string; code?: ErrorCode; details?: unknown }) {
    super({
      statusCode: 403,
      code: params?.code ?? ErrorCodes.FORBIDDEN,
      message: params?.message ?? 'Forbidden',
      details: params?.details,
    });
  }
}

export class PermissionDeniedError extends AuthorizationError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      code: ErrorCodes.PERMISSION_DENIED,
      message: params?.message ?? 'You do not have permission to perform this action',
      details: params?.details,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(params?: { message?: string; code?: ErrorCode; details?: unknown }) {
    super({
      statusCode: 404,
      code: params?.code ?? ErrorCodes.NOT_FOUND,
      message: params?.message ?? 'Resource was not found',
      details: params?.details,
    });
  }
}

export class ConflictError extends AppError {
  constructor(params?: { message?: string; code?: ErrorCode; details?: unknown }) {
    super({
      statusCode: 409,
      code: params?.code ?? ErrorCodes.CONFLICT,
      message: params?.message ?? 'Conflict',
      details: params?.details,
    });
  }
}

export class RateLimitError extends AppError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      statusCode: 429,
      code: ErrorCodes.RATE_LIMITED,
      message: params?.message ?? 'Too many requests',
      details: params?.details,
    });
  }
}

export class SessionExpiredError extends AuthenticationError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      code: ErrorCodes.SESSION_EXPIRED,
      message: params?.message ?? 'Session expired',
      details: params?.details,
    });
  }
}

export class SessionRevokedError extends AuthenticationError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      code: ErrorCodes.SESSION_REVOKED,
      message: params?.message ?? 'Session has been revoked',
      details: params?.details,
    });
  }
}

export class TokenReuseDetectedError extends AuthenticationError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      code: ErrorCodes.TOKEN_REUSE_DETECTED,
      message: params?.message ?? 'Refresh token reuse detected',
      details: params?.details,
    });
  }
}

export class InfrastructureUnavailableError extends AppError {
  constructor(params?: { message?: string; details?: unknown }) {
    super({
      statusCode: 503,
      code: ErrorCodes.INFRASTRUCTURE_UNAVAILABLE,
      message: params?.message ?? 'Required infrastructure is unavailable',
      details: params?.details,
      isOperational: true,
    });
  }
}

export class InternalServerError extends AppError {
  constructor(params?: { message?: string; details?: unknown; cause?: unknown }) {
    super({
      statusCode: 500,
      code: ErrorCodes.INTERNAL_SERVER_ERROR,
      message: params?.message ?? 'Internal server error',
      details: params?.details,
      isOperational: false,
      cause: params?.cause,
    });
  }
}

import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env } from '../../config/env';
import { logger } from '../../infrastructure/observability/logger';
import {
  AppError,
  InfrastructureUnavailableError,
  MalformedJsonError,
  NotFoundError,
  ValidationError,
} from '../errors/app-error';
import { ErrorCodes } from '../errors/error-codes';
import { buildErrorResponse } from '../http/error-response';

function mapPrismaError(err: Prisma.PrismaClientKnownRequestError): AppError {
  if (err.code === 'P2002') {
    return AppError.conflict('Unique constraint violation');
  }
  if (err.code === 'P2025') {
    return AppError.notFound('Record not found');
  }
  if (err.code === 'P2003') {
    return AppError.conflict('Related record constraint violation');
  }
  if (err.code === 'P2014') {
    return AppError.conflict('Invalid relation change');
  }
  return AppError.internal('Database error');
}

function mapZodError(err: ZodError): ValidationError {
  const details = err.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  return new ValidationError({
    message: 'Request validation failed',
    details,
  });
}

function isMalformedJsonError(err: unknown): boolean {
  if (err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400) {
    return true;
  }
  if (
    err &&
    typeof err === 'object' &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.parse.failed'
  ) {
    return true;
  }
  return false;
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  if (err instanceof ZodError) {
    return mapZodError(err);
  }
  if (isMalformedJsonError(err)) {
    return new MalformedJsonError();
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return mapPrismaError(err);
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return new ValidationError({
      message: 'Invalid database query input',
    });
  }
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    return new InfrastructureUnavailableError({
      message: 'Database is unavailable',
    });
  }
  if (err instanceof Error) {
    return AppError.internal('Internal server error');
  }
  return AppError.internal('Unknown error');
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(
    new NotFoundError({
      code: ErrorCodes.ROUTE_NOT_FOUND,
      message: 'The requested endpoint does not exist',
    }),
  );
}

/**
 * Sole production serializer for error JSON responses.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError = toAppError(err);
  const isProd = env().NODE_ENV === 'production';
  const requestId = req.requestId;

  const logPayload = {
    requestId,
    code: appError.code,
    statusCode: appError.statusCode,
    path: req.originalUrl,
    method: req.method,
    details: appError.isOperational ? appError.details : undefined,
    err:
      !appError.isOperational || appError.statusCode >= 500
        ? err instanceof Error
          ? { message: err.message, stack: err.stack, name: err.name }
          : err
        : undefined,
  };

  if (appError.statusCode >= 500 || !appError.isOperational) {
    logger.error(logPayload, appError.message);
  } else {
    logger.warn(logPayload, appError.message);
  }

  const hideInternals =
    isProd && (appError.statusCode >= 500 || !appError.isOperational);

  res.status(appError.statusCode).json(
    buildErrorResponse({
      statusCode: appError.statusCode,
      code: hideInternals ? ErrorCodes.INTERNAL_SERVER_ERROR : String(appError.code),
      message: hideInternals ? 'Internal server error' : appError.message,
      details: hideInternals ? undefined : appError.details,
      requestId,
    }),
  );
}

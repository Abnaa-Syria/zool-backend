import type { Response } from 'express';

export type SuccessResponseMeta = {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  requestId?: string;
  [key: string]: unknown;
};

export type SuccessResponse<T> = {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  meta?: SuccessResponseMeta;
};

export type SuccessResponseOptions<T> = {
  statusCode?: number;
  message: string;
  data: T;
  meta?: SuccessResponseMeta | Record<string, unknown>;
  requestId?: string;
};

/**
 * Centralized success serializer. Controllers must use this instead of res.json.
 * Allowed production JSON serializers: this helper + global error handler.
 */
export function successResponse<T>(
  res: Response,
  options: SuccessResponseOptions<T>,
): Response {
  const statusCode = options.statusCode ?? 200;

  if (statusCode === 204) {
    return res.status(204).send();
  }

  const meta: SuccessResponseMeta = {
    ...(options.meta ?? {}),
  };
  if (options.requestId) {
    meta.requestId = options.requestId;
  }

  const body: SuccessResponse<T> = {
    success: true,
    statusCode,
    message: options.message,
    data: options.data,
  };

  if (Object.keys(meta).length > 0) {
    body.meta = meta;
  }

  return res.status(statusCode).json(body);
}

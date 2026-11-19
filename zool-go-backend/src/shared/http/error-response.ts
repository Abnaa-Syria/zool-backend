export type ErrorResponse = {
  success: false;
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
};

export function buildErrorResponse(input: {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}): ErrorResponse {
  return {
    success: false,
    statusCode: input.statusCode,
    code: input.code,
    message: input.message,
    ...(input.details !== undefined ? { details: input.details } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
}

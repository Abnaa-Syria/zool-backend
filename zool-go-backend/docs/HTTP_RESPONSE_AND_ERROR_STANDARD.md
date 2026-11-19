# HTTP response and error standard

ZoolGo Stage 1 uses one response envelope for every API JSON response. Controllers, services, and repositories must not invent local envelopes.

## Successful response

```ts
type SuccessResponse<T> = {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    requestId?: string;
    [key: string]: unknown;
  };
};
```

Controllers must call `successResponse(res, { statusCode, message, data, meta?, requestId })` from `src/shared/http/success-response.ts`.

Rules:

- Use `201` for creates.
- Use the correct status for the operation; do not default everything to `200`.
- Use `204` only when an endpoint genuinely returns no body (`successResponse` sends an empty body).
- Put pagination fields in `meta`.
- Put `requestId` via the helper option (serialized under `meta.requestId`).

**Binary exception:** ticket PDF downloads (`GET .../tickets/:ticketNumber/pdf`) return `application/pdf` bytes with `Content-Disposition`, not the JSON success envelope. Errors on those routes still use the global error JSON envelope.

## Error response

```ts
type ErrorResponse = {
  success: false;
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
};
```

Only the global error handler (`src/shared/middleware/error-handler.ts`) may serialize error JSON.

## Error code naming

Use `SCREAMING_SNAKE_CASE` codes from `src/shared/errors/error-codes.ts`, for example:

| Code | Typical status |
|------|----------------|
| `VALIDATION_ERROR` | 422 |
| `MALFORMED_JSON` | 400 |
| `AUTHENTICATION_REQUIRED` | 401 |
| `PERMISSION_DENIED` | 403 |
| `NOT_FOUND` / `ROUTE_NOT_FOUND` | 404 |
| `CONFLICT` / `BOOTSTRAP_PROTECTED` | 409 |
| `RATE_LIMITED` / `OTP_COOLDOWN` | 429 |
| `INFRASTRUCTURE_UNAVAILABLE` | 503 |
| `INTERNAL_SERVER_ERROR` | 500 |

Domain codes (`OTP_*`, `SESSION_*`, `AUTH_*`) should stay stable for clients.

## Layer responsibilities

| Layer | May | Must not |
|-------|-----|----------|
| Controller | Call services; `successResponse`; thin orchestration | `try/catch` only for JSON errors; Prisma/Redis; permission math; `res.json` / `res.status().json` |
| Service | Return domain data; throw `AppError` subclasses; own transactions | Import Express; return `{ success }`; choose HTTP response bodies |
| Repository | Return data / null / collections; accept Prisma tx clients | Import Express; invent HTTP status; swallow Prisma causes |
| Middleware (authz/validation/rate-limit) | Throw typed errors / `next(error)` | Manually send error JSON |
| Global error handler | Map unknowns; log once; serialize `ErrorResponse` | Expose stacks, Prisma metadata, secrets in production |

## Which layer throws what

- **Validation middleware** → `ValidationError` (422) with safe `{ path, message }[]` details.
- **Malformed JSON body** → `MalformedJsonError` (400).
- **Authenticate / authz** → `AuthenticationError` (401) with specific codes when useful.
- **Permission middleware** → `PermissionDeniedError` (403).
- **Services** → domain `NotFoundError`, `ConflictError`, OTP/session errors, etc.
- **Repositories** → normally return `null`; services translate to typed errors. Preserve causes when translating infrastructure failures.
- **Not-found route handler** → `NotFoundError` with `ROUTE_NOT_FOUND`.
- **Unexpected failures** → propagate; handler maps to safe 500.

## Prisma translation (global handler)

| Prisma | HTTP | Notes |
|--------|------|-------|
| `P2002` unique | 409 | No raw meta to client |
| `P2025` record missing | 404 | |
| `P2003` / `P2014` relation | 409 | |
| Validation error | 422 | Safe message only |
| Init / panic | 503 | Database unavailable |
| Other known request | 500 | Safe generic |

## Adding a new endpoint

1. Validate input with Zod + `validate({ body/query/params })`.
2. Protect with `authenticate` / `requirePermission` as needed.
3. Implement service that returns data or throws typed `AppError`.
4. Thin controller:

```ts
export const getThing = asyncHandler(async (req, res) => {
  const thing = await thingService.getById(req.params.thingId);
  return successResponse(res, {
    statusCode: 200,
    message: 'Thing retrieved successfully',
    data: thing,
    requestId: req.requestId,
  });
});
```

5. Do not catch errors only to call `res.json`.
6. Update OpenAPI schemas to the shared envelopes.

## Exceptions

- **HTTP 204**: allowed via `successResponse` with `statusCode: 204` (no JSON body).
- **OpenAPI/docs JSON** (`/docs.json`): framework documentation delivery, not an API business response.
- **successResponse / errorHandler**: the only approved production serializers for API JSON.

## Enforcement

`tests/architecture/http-contract.test.ts` fails if production modules call `res.json` / `res.status(...).json` outside approved files, or if services/repositories import Express.

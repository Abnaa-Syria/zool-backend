# ZoolGo — Engineering Troubleshooting Guide

This guide details verified issues, environment traps, and resolution steps encountered during local development and testing of the ZoolGo platform.

---

## 1. Environment and Infrastructure Issues

### Issue 1: Docker Port 6380 Conflict on Startup
- **Symptom:** Running `docker compose up -d` in `zool-go-backend` fails with:
  `Error response from daemon: Ports are not available: exposing port TCP 0.0.0.0:6380 -> 0.0.0.0:0: listen tcp 0.0.0.0:6380: bind: address already in use`
- **Cause:** Another local Redis container (e.g., `lomi-redis`) or host Redis instance is already bound to port 6380.
- **Resolution:**
  1. Inspect running containers:
     ```powershell
     docker ps | Select-String "6380"
     ```
  2. If an existing Redis instance is running and can be shared, update `REDIS_URL` in `.env` to point to it, or stop the conflicting container:
     ```powershell
     docker stop <conflicting_container_id>
     docker compose up -d redis
     ```

### Issue 2: MySQL Connection Refused (`P1001: Can't reach database server at 127.0.0.1:3308`)
- **Symptom:** Server crashes on startup or `npm run prisma:migrate` throws `P1001`.
- **Cause:** The MySQL container `zoolgo-mysql` is stopped or still in its 15-second initialization loop.
- **Resolution:**
  1. Check container health status:
     ```powershell
     docker ps --filter "name=zoolgo-mysql"
     ```
  2. If stopped, start it:
     ```powershell
     docker compose up -d mysql
     ```
  3. Wait until the health check reports `healthy` (MySQL 8.4 takes ~10 seconds on first volume creation to initialize system tables).

### Issue 3: Backend Tests Fail with `Can't reach database server at 127.0.0.1:3307`
- **Symptom:** Running `npm test` in `zool-go-backend` causes 8 test suites to fail during `bootTestApp()`.
- **Cause:** Backend tests explicitly connect to the **test database** container `zoolgo-mysql-test` on port **3307** (`.env.test`), which is separate from the dev database (`3308`).
- **Resolution:**
  Start the test database container:
  ```powershell
  cd d:\zool-go\zool-go-backend
  docker compose up -d mysql-test redis
  npm test
  ```

---

## 2. Prisma ORM and Schema Traps

### Issue 4: Prisma Windows `EPERM: operation not permitted, rename`
- **Symptom:** Running `npx prisma generate` fails on Windows with an `EPERM` error attempting to rename `query_engine-windows.dll.node`.
- **Cause:** An active Node.js process (`npm run dev` or a background Vitest worker) has locked the Prisma query engine DLL file in memory.
- **Resolution:**
  1. Terminate running Node dev servers in terminal: `Ctrl + C`.
  2. Check for lingering Node processes:
     ```powershell
     Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
     ```
  3. Re-run `npx prisma generate`.

### Issue 5: Schema Multi-File Location Error
- **Symptom:** Running Prisma commands in third-party tooling throws: `Could not find a schema.prisma file`.
- **Cause:** ZoolGo uses Prisma 6's multi-file schema feature where schemas are split across `prisma/schema/*.prisma`.
- **Resolution:**
  Ensure `package.json` specifies the directory path:
  ```json
  "prisma": {
    "schema": "prisma/schema"
  }
  ```
  Always run Prisma commands from the `d:\zool-go\zool-go-backend` root.

---

## 3. Authentication and Security Traps

### Issue 6: `devOtp` Missing from API Response
- **Symptom:** Calling `POST /api/v1/auth/otp/request` returns `200 OK`, but the response body contains only `{ challengeId }` without `devOtp`.
- **Cause:** `OTP_DEV_EXPOSE` is set to `false` in `.env`, or `NODE_ENV` is set to `production`.
- **Resolution:**
  In development, set `OTP_DEV_EXPOSE=true` in `zool-go-backend/.env` and restart the server.

### Issue 7: Refresh Cookie Not Received on Cross-Origin Requests
- **Symptom:** Calling `/api/v1/auth/refresh` returns 401 Unauthorized (`REFRESH_TOKEN_REQUIRED`).
- **Cause:** The client browser is omitting credentials, or CORS configuration is rejecting credentials.
- **Resolution:**
  1. Frontend HTTP client must specify `credentials: 'include'` (Fetch) or `withCredentials: true` (Axios).
  2. Verify that `CORS_ORIGINS` in `.env` matches the exact frontend origin (e.g., `http://localhost:5173`). Wildcard `*` cannot be used with credentials.

### Issue 8: 401 Unauthorized vs. 403 Forbidden Confusion
- **Rule of Thumb:**
  - **401 Unauthorized:** The caller is unauthenticated, the JWT expired, or the Redis `authzVersion` did not match token `av`.
  - **403 Forbidden:** The caller is successfully authenticated, but their assigned roles lack the specific permission key required by the endpoint (or a broker token was presented to an admin endpoint).

### Issue 9: Stale Redis Permission Cache
- **Symptom:** An administrator's role permissions were updated in the database, but API requests still fail with 403 Forbidden.
- **Cause:** Redis has cached the user's effective permissions or the user's `authzVersion` was not bumped.
- **Resolution:**
  Flush the test/dev Redis key:
  ```powershell
  docker exec -it zoolgo-redis redis-cli del "zoolgo:authz:permissions:<admin_id>"
  ```

---

## 4. File Upload and Document Generation

### Issue 10: Receipt Evidence Upload Fails with `ENOENT`
- **Symptom:** Calling `POST /api/v1/broker/wallet/top-ups/:id/evidence` returns HTTP 500.
- **Cause:** The target upload directory does not exist on disk.
- **Resolution:**
  Ensure the upload directory exists:
  ```powershell
  New-Item -ItemType Directory -Force -Path "d:\zool-go\zool-go-backend\uploads\receipts"
  ```

### Issue 11: Ticket PDF Download Fails for Cancelled Booking
- **Symptom:** `GET /admin/bookings/:id/tickets/:ticketId/pdf` returns HTTP 409 Conflict.
- **Cause:** By architectural design (`D-TICKET-01`, `bookings.service.ts` L754), tickets for cancelled bookings are voided and cannot be rendered as valid printable passes.

---

## 5. Frontend Common Traps

### Issue 12: Vite Bundle Size Warning (> 500 kB)
- **Symptom:** Running `npm run build` outputs: `(!) Some chunks are larger than 500 kB after minification`.
- **Cause:** Large vendor libraries (`recharts`, `leaflet`, `lucide-react`) are bundled into a single entry chunk.
- **Resolution:** This is non-breaking technical debt. Address during Milestone F by introducing `React.lazy()` route imports in `router/index.tsx`.

### Issue 13: Financial Numbers Render as Millions of SDG
- **Symptom:** A ticket price displays as `1,500,000 SDG` instead of `15,000 SDG`.
- **Cause:** The backend transmits integer minor units (`amountMinor = 1500000`). The frontend mock previously expected major units (`15000.00`).
- **Resolution:** In the frontend adapter or display component, divide minor units by 100: `amountMinor / 100`.

---

*Evidence citations:*
- Upload storage: `d:\zool-go\zool-go-backend\src\infrastructure\storage\local-disk-storage.ts` L1–30
- Ticket PDF check: `d:\zool-go\zool-go-backend\src\modules\bookings\bookings.service.ts` L754–763
- Redis keys: `d:\zool-go\zool-go-backend\src\infrastructure\redis\redis.ts` L11–16

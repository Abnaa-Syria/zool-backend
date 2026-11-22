# 13 — Deployment (staging server, 2026-11-22)

The API runs on the shared company server next to other projects. Everything ZoolGo uses is isolated; nothing of the other projects is touched.

| Item | Value |
|---|---|
| Public URL | `https://zoolgo-api.nodeteam.site/api/v1` (Swagger: `/docs`) |
| Folder | `/var/www/zoolgo-api.nodeteam.site` (code + `.env`, mode 600) |
| Process | pm2 `zoolgo-api` → `node dist/server.js` on `127.0.0.1:4600` |
| Web | Apache vhost `zoolgo-api.nodeteam.site.conf` (+ `-le-ssl.conf` by certbot), reverse proxy to 4600 |
| Database | MySQL 8, database `zoolgo`, user `zoolgo@localhost` (privileges on `zoolgo.*` only) |
| Redis | local Redis, **db 7**, key prefix `zoolgo:` |
| Uploads | `/var/www/zoolgo-api.nodeteam.site/uploads` |

**Mode:** `NODE_ENV=production` with staging switches until the real services are connected (last project phase):
- `OTP_DEV_EXPOSE=false` — codes are never returned by the API. Test accounts log in with **fixed codes** from `OTP_FIXED_CODES` (super admin, broker manager/clerk, drivers `+24990000020*`, test customers `+2499000003*`). The codes are kept by the project owner, not in git.
- `PAYMENT_MOCK_IN_PRODUCTION=true` — mock payment confirm stays available for app testing.
- `DEMO_SCHEDULE_DAYS=14` — demo carrier trips refresh hourly.

At public launch: empty `OTP_FIXED_CODES` (or keep only store-review accounts), set `PAYMENT_MOCK_IN_PRODUCTION=false` and `DEMO_SCHEDULE_DAYS=0`, connect SMS/PSP/FCM.

## Update the API

From a machine with the repo (committed code only):

```bash
git -C zool_BE archive --format=tar.gz --prefix= HEAD:zool-go-backend > zoolgo-api.tgz
scp zoolgo-api.tgz root@<server>:/tmp/
ssh root@<server>
cd /var/www/zoolgo-api.nodeteam.site
tar -xzf /tmp/zoolgo-api.tgz && rm /tmp/zoolgo-api.tgz      # .env and uploads/ are not in the archive
npm ci --no-audit --no-fund
npx prisma generate && npm run build
npx prisma migrate deploy                                   # additive migrations only
pm2 restart zoolgo-api --update-env && pm2 save
curl -s https://zoolgo-api.nodeteam.site/api/v1/health
```

Logs: `pm2 logs zoolgo-api`. Apache logs: `/var/log/apache2/zoolgo-api.nodeteam.site_*.log`.

## Dashboards (Vercel)

Both dashboards ship a `vercel.json` that proxies `/api/*` to `https://zoolgo-api.nodeteam.site/api/*` and falls back to `index.html` for client routes. The browser therefore talks to the dashboard's own domain only (no CORS, first-party refresh cookies). Vercel settings: framework **Vite**, build `npm run build`, output `dist`, no environment variables needed.

# ZoolGo — Backend Repository

| Path | Contents |
|---|---|
| `zool-go-backend/` | Backend API (Express + Prisma + Redis). Start here: [`zool-go-backend/README.md`](zool-go-backend/README.md) |
| `docs/` | Product, decisions, API requirements, handover docs. **Plan:** [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) · **Decisions:** [`docs/BACKEND_DECISION_REGISTER.md`](docs/BACKEND_DECISION_REGISTER.md) · **Status:** [`docs/handover/11_CURRENT_STATUS_AND_GAPS.md`](docs/handover/11_CURRENT_STATUS_AND_GAPS.md) |
| `Zool/` | Mobile app screen exports (customer, driver, broker) and the broker journey PDF |
| `stitch_zoolgo_admin_design_system/` | Admin dashboard design system (Stitch exports) |
| `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md`, `.cursor/`, `.agents/` | Coding rules for AI assistants — one copy each, at the repo root |

Related repository: admin dashboard — https://github.com/Abnaa-Syria/zool-dashboard

Mobile app designs (Figma): https://www.figma.com/design/sz5wZeoY4Bz4rOVhnFpkWq/Zool (page "Test Design").

## Workflow

- Work on a branch, open a PR to `main`; CI must be green.
- Never commit `.env*` files except the `*.example` templates.

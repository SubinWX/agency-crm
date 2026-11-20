# Agency CRM — Phases 1–6 (all MVP phases)

Multi-branch CRM / workshop work-management system built from
`CRM_Workshop_Garage_Management_Master_Prompt.md`. This is **Phase 1**: auth, RBAC,
branches, customers, works, company-wide capacity, calendar, agent work form,
custom fields, worker assignment, completion, approval, comments and image history.
**Phase 2**: invoices, GST, payments, PAID PDF, expenses, agent & worker commission, salary.
**Phase 3**: products, raw materials, suppliers, branch-wise inventory, stock movements & history.
**Phase 4**: in-app, Email, SMS and WhatsApp notifications, provider settings, editable templates, delivery log.
**Phase 5**: separate Support Portal for complaints and requests.
**Phase 6**: reports & exports, graphs dashboard, job costing, agent score, worker performance, customer portal, holiday list.

**Stack:** Next.js 15 (App Router, server actions) · TypeScript · PostgreSQL · Prisma 6 · Tailwind · Zod · Vitest

---

## Quick start (local)

Requires Node 20+. No Docker or system Postgres needed — a real PostgreSQL 17
server runs from `node_modules` via `embedded-postgres`.

```bash
npm install
npm run db            # terminal 1: starts PostgreSQL on localhost:5433 (data in ./.pgdata)
npx prisma migrate deploy
npm run db:seed
npm run dev           # terminal 2: http://localhost:3000
npm run worker        # terminal 3 (optional): sends queued Email / SMS / WhatsApp
```

Already have Postgres (Docker, Homebrew, Neon…)? Skip `npm run db` and set
`DATABASE_URL` in `.env` (see `.env.example`).

### Dev / test accounts

All seeded accounts use the password **`Password@123`** (development only — never in production).

| Portal | URL | Email | Role |
|---|---|---|---|
| Office | `/login` | `superadmin@crm.test` | Super Admin (all branches) |
| Office | `/login` | `admin@crm.test` | Admin (both branches) |
| Office | `/login` | `staff@crm.test` | Staff (Main branch) |
| Agent | `/agent/login` | `agent@crm.test`, `agent2@crm.test` | Agent / Broker |
| Worker | `/worker/login` | `worker1@crm.test` (both), `worker2@crm.test` (Main) | Worker |

Each portal only accepts its own roles (an agent can't sign in at `/login`).

### Tests

```bash
npm test   # needs `npm run db` running; uses a separate crm_test database
```

75 tests (incl. 8 Phase 6 tests, 7 support tests, 13 notification tests, 8 inventory tests and 16 billing tests: GST maths, payment states, concurrent payments, voids, edit locks, commissions, visibility, expenses, salary) cover the business-critical rules: capacity for every role (no bypass),
**12 concurrent bookings racing for 3 slots → exactly 3 succeed**, both branches
sharing one capacity, editable full-slot message + next available dates,
capacity change history/audit, reschedule into a full date, cancel frees a slot,
blocked dates, custom-field validation, location change history, protected
customer info, image replacement keeps history (and hides old versions from
agents), multi-worker assign → complete → reject (worker notified with reason)
→ re-complete → approve, assignment history, branch isolation, agent isolation,
and role-escalation prevention.

---

## How the important rules are enforced

| Rule (spec §) | Where |
|---|---|
| Company-wide capacity, no override (§8, §69) | `src/server/modules/capacity/service.ts` → `lockDateForBooking()` is called inside **every** create/reschedule transaction. There is no parameter to skip it. |
| Concurrency (§61) | One `WorkDay` row per date is locked with `SELECT … FOR UPDATE`; the count happens after the lock, so racing requests are serialised by PostgreSQL. |
| Capacity changes audited (§8) | `CapacityHistory` + `AuditLog`. |
| Full-slot message editable with `{date}` `{capacity}` `{booked_count}` `{remaining_slots}` `{next_available_dates}` (§10) | Settings → stored in `Setting` table. |
| RBAC enforced server-side (§3, §47) | Every service function takes an `Actor` and calls `requirePermission`. Permissions live in the DB (`Role`/`Permission`/`RolePermission`) and are editable by Super Admin at **Roles & permissions**. |
| Branch isolation (§76) | `workAccessWhere()` / `branchScope()` applied in every query. |
| Agent can't edit protected customer info (§12) | Customer edits need `customers.edit`; agents edit only location/details/images on their own open works, with a mandatory reason. |
| Image history (§13) | `WorkImage` (slot) + `WorkImageVersion` (never deleted). DB index guarantees one current version. Old/removed versions are served only to users with `works.view_image_history`. |
| Field history (§70) | `WorkFieldChange` stores previous / new / reason / user / time. |
| Completion → Pending Approval → Approve / Reject with reason (§16–17) | `works/service.ts`; rejection notifies workers and is shown on their screen. |
| Multiple workers + assignment history (§15) | `WorkAssignment` rows are never deleted; DB index prevents duplicate active assignment. |
| Audit log (§44) | `src/server/lib/audit.ts`, written in the same transaction as the change. |
| Files are private (§46) | Uploads are validated by content (magic bytes) and size, stored outside `public/`, and served only via `/api/files/[id]` after an access check. |
| Security (§47) | bcrypt (12 rounds), DB sessions (hashed tokens, httpOnly cookie, revocable), login rate limiting, CSP + security headers, server actions (origin-checked POST → CSRF protection), Zod validation, Prisma parameterised SQL. |

## Project layout

```
prisma/                 schema, migrations, seed
scripts/db.mjs          local embedded PostgreSQL
src/server/             ALL business logic (no React here)
  auth/                 sessions, passwords, rate limit
  rbac/                 permission catalog, Actor, checks
  modules/<area>/       services: capacity, works, customers, custom-fields, users, branches, settings, notifications
  storage/              storage provider (local disk now; S3-compatible later)
src/app/                routes — thin pages + server actions calling services
  admin/                office portal (Super Admin / Admin / Staff)
  agent/(app)/          agent portal (mobile-first)
  worker/(app)/         worker portal (mobile-first)
  api/                  availability + secure file delivery
src/components/         UI (work form, availability calendar, lightbox, work detail…)
tests/                  Vitest business-rule tests
```

## Architectural decisions

- **Modular monolith.** One Next.js app; business rules live in `src/server/modules`, so a future mobile app or REST API can call the same services.
- **Capacity lock row per date** (rather than a counter) — counts are always derived from real works, so cancellations/date changes can't drift.
- **Statuses that consume capacity:** every status except `CANCELLED`.
- **Past dates** cannot be booked or used as a reschedule target.
- **Agents** always own the works they create; office users can pick an agent.
- **Customer portal ready:** `Customer.userId` + `Portal.CUSTOMER` role exist; only the UI is missing.
- **Numbering** (`WRK-000001`, prefixes configurable) uses an atomic `Counter` upsert.

## Phase 2 — Billing

| Rule | Where |
|---|---|
| Money is exact | `src/server/modules/billing/calc.ts` works in integer paise; DB columns are `DECIMAL(12,2)`. |
| GST (§24) | Business-wide settings (Settings → GST & invoices): on/off, default %, intra-state (CGST+SGST) / inter-state (IGST), rounding. GST number comes from Company details. |
| Invoice linked to work, any time (§23) | Create from the work page, or tick “Create the invoice right after saving” on the office New work form. Customer + company details are snapshotted so old invoices never change. |
| No silent financial edits (§57) | Invoices can't be edited or cancelled once payments exist (void payments first, with reason). Payments and expenses are **voided**, never deleted. DB `CHECK`s: positive payments, no overpayment, non-negative totals. Every change is audited. |
| Concurrent payments | Invoice row is locked (`FOR UPDATE`); tested: 6 simultaneous payments can't exceed the total. |
| Payment methods (§27) | GPay/UPI, Cash, Bank transfer, Card, Other; UPI/bank need a reference. Multiple payments per invoice. |
| PAID PDF (§25–26) | `/api/invoices/[id]/pdf` renders on demand (pdfkit) with logo, GSTIN, items, tax split, amount in words, payments, bank details, terms, and a **PAID** (or CANCELLED) stamp. Open/print or download. |
| Work status | Approved → Invoiced → Payment Pending → Paid is derived automatically from the invoices. |
| Commission (§20–22) | Lines created on approval: agent + each worker (worker % **split** among workers by default, or **each** — configurable). % snapshotted; amount = % × invoice taxable value until approved; manual adjust needs a reason; approve → mark paid. Full history + rate-change history. Personal rate overrides. |
| Workers never see agent commission (§21) | People without `commissions.manage` only ever query their own lines. Worker commission view is off by default (`commissions.view_own`). |
| Expenses (§28) | Category, branch, optional work link, receipt (image/PDF, private). |
| Salary (§29) | Salary amount/type per staff or worker, monthly payment records, void with reason. |

Upgrading an existing database: `npx prisma migrate deploy && npm run db:seed` — the seed grants newly added permissions to existing system roles without overwriting earlier role edits.

## Phase 3 — Inventory

| Rule | Where |
|---|---|
| Products & raw materials (§30–31) | One catalog (`Item`, `kind`) with code/SKU, category, unit, selling & purchase price, supplier, images, notes, status. Managed with `inventory.manage`. |
| Branch-wise stock (§32) | `StockLevel` per item **per branch** — never merged. Inventory page has a tab per branch; item page shows each branch. |
| Every change recorded (§33) | Stock only changes through `moveStock()` (`src/server/modules/inventory/stock.ts`), which writes an append-only `StockMovement` (STK-000001) with before / after / difference / reason / user / branch / time. Types: stock in, out, adjust to count, manual correction, damaged, transfer (out+in pair). |
| Authorised staff edit stock (§20 rule) | `inventory.edit_stock`, only in their own branches. Staff role has it by default. |
| Never negative, safe under load | Rows locked `FOR UPDATE` (transfer locks both branches in a fixed order); DB `CHECK (quantity >= 0)`. Tested: 8 simultaneous stock-outs on 10 units → exactly 3 succeed. |
| Transfers | On/off in Settings → Inventory. |
| Low stock | Per item default, overridable per branch; dashboard list + filter. |
| Suppliers (§34) | Name, company, phone, email, address, GSTIN, notes; linked items; stock-in records the supplier. |
| Job costing (§50) | “Materials used” on the work page issues stock from that work's branch and records quantity × unit cost. |

## Phase 4 — Communication

| Rule | Where |
|---|---|
| Channels (§40) | In-app (always) + Email, SMS, WhatsApp. Events: new work, assigned, removed, date changed, work updated, date fully booked, completed, approved, rejected, cancelled, invoice generated, payment received, commission approved/paid (support updates ready for Phase 5). |
| Providers after subscription (§41, §78) | **Notifications → Providers** (Super Admin, `notifications.manage`). Email: SMTP or Resend. SMS: MSG91 (India DLT flow) or Twilio. WhatsApp: Meta WhatsApp Cloud API or Twilio WhatsApp. Plus **Test mode** (logs only, sends nothing). Each provider is one adapter in `src/server/modules/notifications/providers.ts`. |
| Credentials never exposed | AES-256-GCM encrypted in the DB with `SECRETS_ENCRYPTION_KEY`; UI shows only `••••1234`; blank field keeps the saved value; audit log records *which* secrets changed, never values; provider responses are redacted before storing. |
| Templates (§56) | **Notifications → Templates**: per event × channel on/off, subject (email), text with `{variables}`; unknown variables are rejected on save; “also send to customer” for customer-facing events (invoice, payment, date change, approval). |
| Background sending (§63) | Transactional outbox: `notify()` writes `NotificationDelivery` rows in the same DB transaction as the change, so a rolled-back change sends nothing. `npm run worker` sends them (`FOR UPDATE SKIP LOCKED` — run as many copies as you like, no double sends). Retries 5× with backoff (30s → 32m); bad numbers/auth fail at once; crashed “sending” rows are re-queued. No Redis needed. |
| Delivery log (§77) | **Notifications → Delivery log**: queued / sent / delivered / failed / skipped, attempts, provider message id, provider response, timestamps, retry button, “Send queued now”. |
| Delivered / failed status | Webhooks with signature verification: Meta `POST /api/webhooks/meta-whatsapp` (X-Hub-Signature-256 with app secret; GET verify token) and Twilio `POST /api/webhooks/twilio` (X-Twilio-Signature). Requires `APP_URL` to be public HTTPS. |

**India notes:** SMS needs a DLT-registered template (MSG91 flow ID with one variable). WhatsApp business-initiated messages need a Meta-approved template with one body variable `{{1}}`; the rendered message text is passed into it.

Seed accounts use `@crm.test` emails, which are never emailed (logged as *skipped*).

## Phase 5 — Support Portal

| Rule (§42) | Where |
|---|---|
| Separate portal | `/support` — its own layout, reachable from every portal (office sidebar, agent & worker bottom bar). Any signed-in user with `support.create` (default: all roles) can raise tickets. |
| Ticket fields | SUP-000001 number, title, category, description, priority (Low/Medium/High/Urgent), submitted by, branch, related work, attachments (photos/PDF, private), status, assigned manager, comments, resolution, closed date. |
| Statuses | Open → In Review → In Progress → Waiting for User → Resolved → Closed. A manager's first public reply moves Open → In Review; a requester's reply on *Waiting for User* moves it back to In Review. |
| Manager functions | `support.manage` (Admin & Super Admin): view, reply, **internal notes** (+ internal files, never shown to the requester), assign (only to managers of that branch), change priority / status / category, resolve (resolution required), **close** (confirmation), reopen a closed ticket (reason required). |
| Requester | Sees only own tickets; can reply, confirm a resolved ticket (close) or reopen it with a note. |
| Branch isolation | Managers see their branches' tickets plus company-wide ones; Super Admin sees all. |
| History | Every change in `SupportTicketEvent` (shown as History) + audit log; tickets are never deleted. |
| Notifications | New ticket → branch managers; assignment → assignee; status change / reply → requester (in-app + Email/SMS/WhatsApp templates). |
| Settings | Support → Categories (add, rename, reorder, deactivate). Message wording under Notifications → Templates. |

## Phase 6 — Advanced

| Spec | Where |
|---|---|
| Reports (§37) | **Reports**: 14 reports — work, revenue, payment, outstanding (days overdue), expense, profit & loss, agent commission, worker commission, inventory, staff salary, branch performance, work profitability, agent performance, worker performance. Filters: date range, branch, agent, worker, customer, work status, payment status, product, expense category. **Excel (CSV)** and **PDF** export with the same permissions; exports are audited; CSV is protected against spreadsheet formula injection. |
| Graphs (§58) | **Analytics**: monthly revenue / costs / profit, works per day (past + booked), works by status, branch performance, inventory movement, agent and worker performance — with 30 days / 90 days / 12 months / custom range and branch filters, hover tooltips and a table view under every chart. |
| Profit & loss | Management view, excl. GST: revenue (invoice taxable value) − expenses − salaries − approved commission − materials issued to works. |
| Job costing (§50) | Work page → **Job costing**: revenue − materials − agent & worker commission − linked expenses = profit and margin. |
| Agent score (§51) | Completion, on-time (approved within N grace days of the work date), few cancellations and work value vs. top agent → score 0–100 and Gold / Silver / Bronze / Needs attention / New. Weights, grace days and minimum works in **Settings**. Agents see their own at **Agent → Score**; office sees everyone in Analytics/Reports. |
| Worker performance (§52) | Assigned, completed, rework requests, first-time-right %, average hours to complete, commission — office only (`reports.view`). |
| Customer portal (§43) | Office gives a customer a login from **Customers → Edit → Customer portal**. Customers sign in at `/portal/login` and see only their works (customer-friendly status), completion photos after approval (setting), invoices with PDF (PAID stamp), payments (setting), outstanding balance, and can raise support requests linked to their record. Separate customer-safe queries and file routes; staff pages and APIs refuse customers. |
| Holidays (§54) | Calendar → **Holidays & closed dates** list + block/unblock form; closed dates refuse bookings with the reason and suggest other dates. |

## Possible next steps

- Password reset by email (needs the email provider configured).
- S3-compatible file storage adapter and image thumbnails for production.
- Redis-backed login rate limiting when running several app instances.
- Customer feedback / ratings to feed agent and worker scores.
## Production notes

- Set `DATABASE_URL`, `BUSINESS_TIMEZONE`, and replace local storage with an S3-compatible provider (`src/server/storage`).
- Run `npx prisma migrate deploy` on release. Never run `migrate reset` against production.
- Use HTTPS (HSTS header is sent in production), automated DB backups, and object-storage backups.

# Sandy Collection — Shop Management System

> **CUSTOMER is KING, King never Bargain!**

A simple point-of-sale, stock and reporting system for Sandy Collection's two branches.
Runs on one shop computer, opens in any browser on phones and laptops. No subscription.

- Currency: **UGX**, no VAT
- **Main Branch** — discounts fully locked
- **Branch Two** — discounts allowed up to 10% (reason required, always logged)
- Receipts: **printed** (thermal/any printer) **and SMS** (queued for an SMS provider)

## Run it

```bash
# 1. install
cd server && npm install && cd ../web && npm install && cd ..

# 2. create the database with the two branches, six staff and demo stock
cd server && npm run seed

# 3a. development (two terminals)
cd server && npm run dev      # API on http://localhost:4000
cd web && npm run dev         # shop screen on http://localhost:5173

# 3b. shop computer (one process, serves everything on port 4000)
cd web && npm run build
cd ../server && npm start
```

Then on the shop computer open `http://localhost:4000`.
On phones/tablets on the same Wi‑Fi open `http://<shop-computer-ip>:4000` — in Chrome or Safari
choose *Add to Home screen* and it behaves like an installed app.

## Deployment to a public host

This app requires a Node.js backend and SQLite, so it must be deployed on a host that supports a full Node process. Static-only hosts like InfinityFree will not work for the full app.

Recommended deployment options:

- Render.com (Web Service)
- Railway.app
- Heroku
- Fly.io
- Azure App Service

### Root repository setup

The repository now includes a root `package.json` configured as a workspace with `server` and `web`.
The deploy host should run:

```bash
npm install
npm start
```

That will install dependencies, build the React frontend, and start the Express backend.

### Build and start commands

- Build: `npm run build`
- Start: `npm start`

### Port and public URL

The server listens on `process.env.PORT || 4000`, so the host's assigned port is supported. Once deployed, the app will be reachable at the host's public URL, for example:

`https://your-app.onrender.com`

### If you use Heroku

The repository includes a `Procfile` with:

```text
web: npm start
```

The server will serve the built frontend from `web/dist` automatically.

### If you use Docker

A `Dockerfile` is included for container deployment. It installs dependencies, builds the frontend, and starts the backend on port `4000`.

## Important note

This is not a static site. The `server` process must run continuously so the frontend can talk to `/api` and the SQLite database can be used.

## Demo sign-ins

| Username | PIN | Role | Branch |
| --- | --- | --- | --- |
| owner | 1234 | Owner (all branches) | Main |
| main.manager | 1111 | Manager | Main |
| main.sales | 2222 | Attendant | Main |
| two.manager | 3333 | Manager | Two |
| two.sales1 | 4444 | Attendant | Two |
| two.sales2 | 5555 | Attendant | Two |

Change these in **Settings → Staff** before going live.

## The four screens

- **Sell** — search or scan, tap to add, choose payment (cash / mobile money / card), see change due,
  print or SMS the receipt. Discounts appear only at branches where they are allowed.
- **Stock** — per-branch quantities, receive stock, stock count with reason, branch-to-branch transfers
  (the receiving branch must accept), low-stock list.
- **Reports** — revenue, discounts, gross profit (owner/manager), cash-up sheet, best sellers,
  sales by branch and by staff, today's sales with void, CSV export.
- **Settings** — branches and discount rules, staff and roles, stock valuation, SMS queue.

## Who can do what

| | Owner | Manager | Attendant |
| --- | --- | --- | --- |
| Sell | ✓ | ✓ | ✓ |
| See cost price & profit | ✓ | ✓ | — |
| Receive stock, count, transfer | ✓ | ✓ | — |
| Void a sale | ✓ | ✓ | — |
| Change prices | ✓ | — | — |
| Add staff, set discount rules | ✓ | — | — |
| See other branches | ✓ | — | — |

## Offline behaviour

If the network drops, a sale is stored on the device and retried automatically every 15 seconds and
whenever the connection returns. Each sale carries a `client_uid`, so a re-sent sale is never counted twice.

## Data & backups

Everything lives in one SQLite file: `server/data/sandy.db`.
Back it up by copying that file (a nightly copy to a USB stick or Google Drive is enough).

## Connecting real SMS

Outgoing receipts are written to the `sms_outbox` table and shown in **Settings**. To send them for real,
add a provider (e.g. Africa's Talking or a local aggregator) in `server/src/routes/sales.js` where the
outbox row is created, or write a small worker that reads `status='queued'` rows and marks them `sent`.

## Layout

```text
server/   Node + Express + SQLite API (schema, seed, sales, stock, reports, admin)
web/      React PWA (Sell, Stock, Reports, Settings)
```

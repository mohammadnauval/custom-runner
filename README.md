# API Test Runner

Upload a Postman Collection (v2.1 JSON) and a CSV of data, and the app runs every request in the collection once per CSV row, substituting `{{variables}}` from that row, then reports pass/fail with full request/response detail.

There are two deployment shapes in this repo:

| | Path | Stack | Use when |
|---|---|---|---|
| **Vercel (recommended)** | `frontend/` | Single Next.js app, Postgres only | You want a hosted URL with no servers to run |
| **Self-hosted** | `frontend/` + `backend/` | Next.js + Fastify + Redis + MinIO | You need long-running workers, private-network targets, or no row limits |

The Vercel version is a complete, standalone app: the Next.js project contains its own API routes, database schema, and execution engine. `backend/` and `docker-compose.yml` are only needed for the self-hosted setup.

---

## Deploying to Vercel

### Why the architecture changed

Vercel runs serverless functions, not long-lived processes. The self-hosted design does not translate directly, so the Vercel app makes these substitutions:

| Self-hosted | Vercel | Reason |
|---|---|---|
| Fastify server on port 4000 | Next.js API routes (`src/app/api/**`) | One deployable, no separate server process |
| BullMQ worker + Redis | Chunked executor (`POST /api/runs/[id]/execute`) | No background process can outlive a request |
| Server-Sent Events | Polling (1.5s while active) | Serverless functions can't hold open streams |
| MinIO / S3 | File contents stored in Postgres | Removes a whole service; files are small |

**How a run executes.** A function invocation can't run for the length of a whole test run, so a run advances in chunks. Each call to `POST /api/runs/:id/execute` takes a lease on the run, issues requests for ~30 seconds, saves everything it did, and reports whether work remains. The browser keeps calling until the run reports `done`. Because every completed request is written to the database as it happens, the next chunk resumes exactly where the last one stopped.

**The practical consequence:** keep the Run History tab open while a run executes. If you close it, the run pauses and resumes the next time you open the app. See [Unattended runs](#unattended-runs-optional) to remove that requirement.

### Step 1 — Create a Postgres database

Any Postgres works. [Neon](https://neon.tech) has a usable free tier and works well with serverless.

From the Neon dashboard, copy **both** connection strings:

- **Pooled** — the host contains `-pooler`. This goes into Vercel.
- **Direct** — no `-pooler`. Use this for the one-time schema push.

On Supabase the equivalents are the "Connection pooling" URI (port 6543, add `?pgbouncer=true`) and the direct URI (port 5432).

Serverless functions open many short-lived connections, so the pooled string matters — a direct connection will exhaust the connection limit under load.

### Step 2 — Push the schema

Run once from your machine, using the **direct** URL:

```bash
cd custom-runner/frontend
npm install
```

Create `frontend/.env`:

```env
DATABASE_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require"
```

Then:

```bash
npm run db:push
```

This creates the `collections`, `csv_files`, `environments`, `runs`, `iterations`, and `request_results` tables.

### Step 3 — Push the code to Git

Vercel deploys from a Git repository. If `custom-runner` isn't already its own repo:

```bash
cd custom-runner
git init
git add .
git commit -m "API Test Runner"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`frontend/.gitignore` already excludes `.env`, so your connection string stays local.

### Step 4 — Import the project into Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and select the repository.
2. Set **Root Directory** to `frontend`.
   This is the one setting that's easy to miss. If the repo root is the `custom-runner` folder, the value is `frontend`. If you pushed a parent folder, use the full path, e.g. `custom-runner/frontend`.
3. Framework Preset should auto-detect as **Next.js**. Leave build settings alone — `npm run build` already runs `prisma generate`.
4. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Your **pooled** connection string |

5. Click **Deploy**.

### Step 5 — Verify

Open the deployment URL and check `/api/collections` returns `[]`. An empty array means the database connection works. A 500 means `DATABASE_URL` is wrong or the schema wasn't pushed.

Then run a real test: upload a collection and CSV under **Files**, start a run from **New Run**, and watch **Run History**.

### Local development against the same setup

```bash
cd custom-runner/frontend
npm run dev
```

Opens on http://localhost:3000 with the API routes served from the same process. No Docker, Redis, or MinIO needed.

---

## Vercel constraints to know about

These are platform limits, not app bugs. Each has a workaround.

**Function duration — 60s on Hobby.** A chunk issues requests for 30s then hands control back, so total run length is unbounded. Only a *single* request taking longer than `REQUEST_TIMEOUT_MS` (20s default) is a problem; it's recorded as a timeout failure.

On Pro you can go faster by raising both limits together — `maxDuration` in `src/app/api/runs/[id]/execute/route.ts` and the `EXEC_TIME_BUDGET_MS` environment variable — which means fewer round trips per run.

**Upload size — 4.5MB request body.** The upload routes reject files above 4MB with a clear message rather than letting the platform return an opaque 413. Larger collections need the self-hosted setup or a direct-to-blob upload.

**No private network access.** Functions run on public infrastructure, so they can't reach `localhost` or your VPC. The SSRF guard in `src/server/http-client.ts` blocks those targets deliberately. Testing internal APIs requires the self-hosted deployment.

**Runs pause when the tab closes.** Covered next.

**Response bodies are truncated** to 200,000 characters before storage (`MAX_STORED_BODY_BYTES`) to keep database rows manageable.

### Unattended runs (optional)

`GET /api/cron/resume` picks up any run that has no active lease and advances it one chunk. To have runs continue without a browser open:

1. Add `CRON_SECRET` to your Vercel environment variables (any long random string). The endpoint returns 503 while unset, so it is never an unauthenticated trigger.
2. Create `frontend/vercel.json`:

   ```json
   {
     "crons": [{ "path": "/api/cron/resume", "schedule": "* * * * *" }]
   }
   ```

Sub-daily cron schedules require a Vercel Pro plan. On Hobby the minimum granularity is once per day, which isn't frequent enough to drive a run — keep the tab open instead.

---

## Configuration reference

Only `DATABASE_URL` is required. The rest tune the executor.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string (pooled, in production) |
| `EXEC_TIME_BUDGET_MS` | `30000` | Time one chunk spends issuing requests. Keep well under `maxDuration` |
| `EXEC_LEASE_MS` | `90000` | Lease duration. Must exceed `maxDuration` so a slow invocation isn't preempted |
| `REQUEST_TIMEOUT_MS` | `20000` | Per-request timeout. Keep below `EXEC_TIME_BUDGET_MS` |
| `MAX_STORED_BODY_BYTES` | `200000` | Response body truncation threshold |
| `CRON_SECRET` | unset | Enables `/api/cron/resume`. Disabled while unset |

See `frontend/.env.example`.

---

## Using the app

### 1. Upload files

**Files** tab. Export your collection from Postman via right-click → Export → Collection v2.1, then drop the JSON in. Upload a CSV whose first row is the header.

### 2. Create an environment (optional)

**Environments** tab. Useful for values shared across every row — `baseUrl`, `apiKey`. CSV values override environment values when both define the same variable name.

### 3. Start a run

**New Run** tab, three steps: pick the collection and CSV, map CSV columns to collection variables (columns matching a variable name are mapped automatically), then confirm.

### 4. Watch and export

**Run History** shows live progress. Keep the tab open. When finished, download results as CSV (flat, one row per request) or JSON (full detail including bodies and test results).

### Variable substitution

`{{variable}}` placeholders are replaced everywhere Postman replaces them:

| Location | Example |
|---|---|
| URL | `{{baseUrl}}/api/users/{{userId}}` |
| Header values | `Authorization: Bearer {{apiToken}}` |
| Header keys | `{{customHeaderName}}: value` |
| Query parameters | `?page={{pageNumber}}` |
| Raw JSON body | `{"name": "{{userName}}"}` |
| Form / urlencoded fields | `username={{user}}` |
| Request name | `Create user {{userName}}` |

Unknown variables are left as literal `{{name}}` text rather than replaced with an empty string, so a missing mapping is visible in the results instead of silently producing a malformed request.

Precedence: **CSV row value** > **environment value**.

### Pass/fail rules

- No test script: pass when the status is 2xx or 3xx.
- Test script present: the assertions decide. Any failing `pm.test` fails the request.
- Transport error or timeout: fail, with the message stored on the result.

Supported subset of the Postman sandbox: `pm.test`, `pm.expect`, `pm.response.code`, `pm.response.json()`, `pm.response.text()`, `pm.response.headers.get()`, `pm.response.to.have.status/header/body/jsonBody`, `pm.response.to.be.ok`. Scripts run in a `node:vm` context with a 3s timeout and no network or filesystem access.

Not supported: `pm.sendRequest`, pre-request scripts (parsed but not executed), OAuth2 flows (pass a token via an environment variable instead), and file uploads in form-data.

### CSV format

Header row required. Comma, semicolon, and tab delimiters are auto-detected. RFC 4180 quoting is handled, so embedded commas and newlines are fine. UTF-8 BOM is stripped.

```csv
userId,email,name
1,john@example.com,John Doe
2,jane@example.com,"Smith, Jane"
```

---

## API reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/collections` | List collections |
| POST | `/api/collections/upload` | Upload collection (multipart, field `file`) |
| GET | `/api/collections/:id` | Collection metadata |
| GET | `/api/collections/:id/requests` | Parsed request list |
| DELETE | `/api/collections/:id` | Delete (409 if used by a run) |
| GET | `/api/csv` | List CSV files |
| POST | `/api/csv/upload` | Upload CSV (multipart, field `file`) |
| GET | `/api/csv/:id` | CSV metadata |
| GET | `/api/csv/:id/preview` | First 5 rows |
| DELETE | `/api/csv/:id` | Delete (409 if used by a run) |
| GET | `/api/environments` | List environments |
| POST | `/api/environments` | Create |
| GET | `/api/environments/:id` | Get one |
| PUT | `/api/environments/:id` | Update |
| DELETE | `/api/environments/:id` | Delete (409 if used by a run) |
| GET | `/api/runs` | List runs (`?limit=&offset=`) |
| POST | `/api/runs` | Create a run (status `PENDING`) |
| **POST** | **`/api/runs/:id/execute`** | **Advance one chunk. Call until `done: true`** |
| GET | `/api/runs/:id` | Run detail |
| GET | `/api/runs/:id/iterations` | Iterations |
| GET | `/api/runs/:id/iterations/:iterationId/requests` | Request results |
| POST | `/api/runs/:id/cancel` | Cancel |
| DELETE | `/api/runs/:id` | Delete |
| GET | `/api/runs/:id/export/csv` | Export CSV |
| GET | `/api/runs/:id/export/json` | Export JSON |
| GET | `/api/cron/resume` | Resume a stalled run (needs `CRON_SECRET`) |

### `/execute` response shapes

```jsonc
{ "status": "progress",     "done": false, "completedIterations": 12, "totalIterations": 50, ... }
{ "status": "finished",     "done": true,  "runStatus": "COMPLETED", ... }
{ "status": "busy",         "done": false }   // another caller holds the lease; back off
{ "status": "not_runnable", "done": true, "runStatus": "CANCELLED" }
```

Concurrency is safe: the database lease means extra callers get `busy` rather than duplicating work.

---

## Project structure

```
custom-runner/
├── frontend/                      # The Vercel app (full-stack Next.js)
│   ├── prisma/schema.prisma       # Postgres schema (file contents + lease column)
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/               # All API routes
│   │   │   │   ├── collections/
│   │   │   │   ├── csv/
│   │   │   │   ├── environments/
│   │   │   │   ├── runs/          # includes [id]/execute
│   │   │   │   └── cron/resume/
│   │   │   └── page.tsx           # Tabbed UI
│   │   ├── components/
│   │   │   ├── files-manager.tsx
│   │   │   ├── environments-manager.tsx
│   │   │   ├── new-run-wizard.tsx
│   │   │   ├── run-history.tsx
│   │   │   └── run-detail-dialog.tsx
│   │   ├── lib/
│   │   │   ├── api.ts             # Typed client
│   │   │   └── use-run-driver.ts  # Drives /execute until done
│   │   └── server/                # Server-only code
│   │       ├── executor.ts        # Chunked, resumable engine
│   │       ├── collection-parser.ts
│   │       ├── csv-parser.ts
│   │       ├── http-client.ts     # fetch + SSRF guard + timeout
│   │       ├── script-sandbox.ts  # pm.* subset in node:vm
│   │       └── prisma.ts
│   └── .env.example
│
├── backend/                       # Self-hosted only (Fastify + BullMQ worker)
├── docker-compose.yml             # Self-hosted only (Postgres + Redis + MinIO)
└── README.md
```

---

## Self-hosted setup

Choose this when you need to reach private networks, upload files over 4MB, or run without a browser tab open.

Requires Docker. On Windows, Docker Desktop provides `docker compose` (no hyphen); the standalone `docker-compose` binary is legacy.

```bash
cd custom-runner
docker compose up -d          # Postgres, Redis, MinIO

cd backend
npm install
cp .env.example .env
npm run db:setup
npm run dev                   # API on :4000

# separate terminal
npm run dev:worker            # BullMQ worker
```

The `backend/` app has its own Prisma schema that stores files in MinIO rather than Postgres, and its own SSE endpoint. Point a frontend at it by restoring the API proxy rewrite in `frontend/next.config.js`:

```js
async rewrites() {
  return [{ source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' }];
}
```

Note that the two schemas differ, so a single database can't serve both deployments.

---

## Troubleshooting

**`/api/collections` returns 500 on Vercel.** Either `DATABASE_URL` is missing or wrong, or the schema was never pushed. Check the function logs in the Vercel dashboard for the Prisma error, and confirm `npm run db:push` completed against the same database.

**Build fails with `@prisma/client did not initialize yet`.** `prisma generate` didn't run. The `build` script and a `postinstall` hook both invoke it, so this usually means the Root Directory is pointing somewhere without `prisma/schema.prisma`.

**"Too many connections."** You're using the direct connection string in production. Switch `DATABASE_URL` to the pooled one.

**A run sits at 0% and never moves.** The browser drives execution. Open the Run History tab and leave it open. Check the browser console and the Vercel logs for `/api/runs/[id]/execute`.

**A run is stuck at `RUNNING` with no progress.** A chunk crashed while holding the lease. Leases expire after `EXEC_LEASE_MS` (90s), after which the driver picks it back up automatically. Wait ~2 minutes before investigating further.

**Every request fails with "Blocked target".** The target URL is `localhost`, a private IP range, or a cloud metadata address. Serverless functions can't reach those; use the self-hosted deployment for internal APIs.

**Requests time out at 20s.** Raise `REQUEST_TIMEOUT_MS`, but keep it below `EXEC_TIME_BUDGET_MS` or a single slow request can overrun the chunk budget.

---

## License

MIT

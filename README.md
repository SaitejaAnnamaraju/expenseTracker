# Business Expense Tracker

A secure, server-rendered web app where registered users submit business expenses with scanned receipts. **Feature 1 (Add Expenses)** from the assignment is implemented in full, and every expense is saved permanently in **MySQL**.

> Scope: only Feature 1 is implemented. There is **no** homepage expense list (Feature 2), **no** individual expense or receipt-viewer page (Feature 3), and **no** approve/decline workflow (Feature 4). Every expense is stored with status `not-approved`. `manager1` is only a test login.

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ (tested on 24) |
| Server | Express 4, EJS server-rendered views |
| Database | MySQL 8.x (tested on 8.4 LTS) via `mysql2` prepared statements |
| Sessions | `express-session`, stored in MySQL (`express-mysql-session`) |
| Auth | `bcryptjs` (cost 12), session fixation protection, login rate limiting |
| Uploads | `multer` (disk storage outside the web root) plus a magic-byte file signature check |
| Security | `helmet` (strict CSP, no inline scripts), synchronizer-token CSRF, DOMPurify for Markdown |
| UI | Hand-written CSS design system (light/dark), Lucide icons, Chart.js |

## Features

### Feature 1: Add Expense (`/expenses/new`)
- **Add Expense** button in the sidebar, the top bar and on the dashboard.
- **Date picker**: defaults to today, allows past dates, blocks future dates (client `max` plus a server check), and rejects impossible dates such as 30 Feb.
- **Category** dropdown with exactly *Travel, Food & Drink, Accommodation, Other*. The database enforces this with an `ENUM`.
- **Label**: required, 120 characters at most, with a live counter and suggestions.
- **Amount** in GBP (£): positive, at most 2 decimal places, £1,000,000 at most. Negative values, `0`, `1e3`, `abc` and `1.234` are rejected on both client and server.
- **Description**: optional Markdown with a toolbar and a *Preview* tab. The preview is sanitised with DOMPurify, and the CSP blocks inline handlers as a second layer of defence.
- **Receipt upload**: JPG, JPEG, PNG or PDF, 5 MB at most.
  - Click or drag-and-drop, with the filename and size shown.
  - Image preview, plus *Replace* and *Remove* buttons.
  - The type is checked by extension, MIME type **and file signature** on the server.
  - Files are stored with random names in `storage/receipts/<userId>/`, which the web server never exposes.
- **Submit / Cancel**:
  - A loading spinner shows during submission, then a success toast and a confirmation dialog.
  - Errors are shown next to each field.
  - Cancel asks for confirmation if you have unsaved changes.
- **Duplicate prevention**:
  - The button is disabled while a submission is in flight.
  - Each form carries a single-use token stored in the session.
  - An in-process lock covers truly simultaneous requests.
- **Values the user cannot set**: `username` comes from the session, `submitted_at` from `UTC_TIMESTAMP()`, and `status` is always `'not-approved'`. Any such fields sent in the request are ignored.

### Additional features
- **Dashboard**: total expenses, total amount, this month's submissions and the average amount. It also shows a 12-month bar chart, a category doughnut and recent account activity. It never lists individual expenses.
- **Analytics** (`/analytics`): filter by date range, category, minimum/maximum amount and submission month. You get summary cards, monthly and category charts, and an aggregated category table.
- **CSV export** (`/analytics/export.csv`): exports your own records only, applying the current filters.
  - The username always comes from the session.
  - Cells starting with `=`, `+`, `-` or `@` are neutralised so they can't run as spreadsheet formulas.
  - The file starts with a UTF-8 byte-order mark so the £ sign displays correctly in Excel.
- **Profile** (`/profile`):
  - View your username and update your display name.
  - Change your password (requires the current one, and signs out your other sessions).
  - Upload or remove a profile picture.
- **UI**:
  - Light/dark mode (remembered per browser), responsive layout with a mobile slide-out sidebar.
  - Loading skeletons, toasts, empty states and confirmation dialogs.
  - Show/hide password, a password strength meter and a *Remember me* option (30-day cookie).

## Project structure

```
expencetracke/
├── database/
│   └── schema.sql            # MySQL schema (users, expenses, activity_log, sessions)
├── scripts/
│   ├── setup-db.js           # one-shot: create DB + least-privilege user, migrate, seed
│   ├── migrate.js            # applies database/schema.sql (idempotent)
│   ├── seed.js               # creates user1 / manager1 (bcrypt-hashed)
│   └── e2e-test.js           # 81 end-to-end checks against the running app + MySQL
├── src/
│   ├── server.js             # entry point (verifies DB connection, starts HTTP server)
│   ├── app.js                # express app: helmet/CSP, sessions, CSRF, routes, errors
│   ├── config/  index.js, db.js
│   ├── middleware/  auth.js, csrf.js, upload.js
│   ├── routes/  auth.js, expenses.js, dashboard.js, profile.js
│   ├── services/  stats.js, activity.js
│   └── utils/  validators.js, fileSignature.js
├── views/                    # EJS templates (auth/, expenses/, partials/, dashboard, analytics, profile, error)
├── public/                   # css/app.css, js/*.js, img/favicon.svg
├── storage/                  # receipts/ and avatars/ (private, git-ignored)
├── .env.example
└── package.json
```

## Database schema (summary)

```sql
CREATE TABLE expenses (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL,                       -- FK -> users.username
  expense_date  DATE         NOT NULL,
  category      ENUM('Travel','Food & Drink','Accommodation','Other') NOT NULL,
  label         VARCHAR(120) NOT NULL,
  amount        DECIMAL(10,2) NOT NULL CHECK (amount > 0),   -- GBP
  description   TEXT NULL,                                   -- Markdown source
  receipt_path  VARCHAR(255) NULL,                           -- relative to storage/receipts
  submitted_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- UTC
  status        ENUM('not-approved','approved','declined') NOT NULL DEFAULT 'not-approved',
  CONSTRAINT fk_expenses_user FOREIGN KEY (username) REFERENCES users(username)
    ON UPDATE CASCADE ON DELETE RESTRICT
);
```
The full schema, including `users`, `activity_log`, `sessions` and the indexes, is in [database/schema.sql](database/schema.sql).

## Installation

### 1. Prerequisites
- **Node.js 20+**
- **MySQL 8.x** running locally. Any install works: MySQL Installer, XAMPP/MAMP, Docker (`docker run -p 3306:3306 -e MYSQL_ROOT_PASSWORD=secret mysql:8.4`) or the ZIP archive.

> **On this machine** MySQL 8.4.7 is installed at `C:\Users\saiteja\mysql`, with its data directory at `C:\Users\saiteja\mysql\data`. It runs as a console process, not a Windows service. Start it with:
> ```powershell
> & "C:\Users\saiteja\mysql\bin\mysqld.exe" --defaults-file="C:\Users\saiteja\mysql\my.ini" --console
> ```
> The root password is the `DB_ROOT_PASSWORD` value in `.env`.

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env      # Windows: copy .env.example .env
```
Edit `.env`:
- Set `SESSION_SECRET` to a long random string.
- Set `DB_PASSWORD` to a password for the new app user.
- Set `DB_ROOT_USER` and `DB_ROOT_PASSWORD` to your MySQL admin login.

### 4. Create the database, app user, schema and test accounts
```bash
npm run db:setup
```
This creates the `expense_tracker` database and the `expense_app` MySQL user. That user only has `SELECT, INSERT, UPDATE, DELETE` rights. The command then applies the schema and seeds:

| Username | Password | Role |
|---|---|---|
| `user1` | `p455w0rd` | user |
| `manager1` | `p455w0rd` | manager (test login only) |

To create the database manually instead, run `mysql -u root -p < database/schema.sql`, then `npm run db:seed`.

## Running

```bash
npm start          # production-style
npm run dev        # auto-restart on changes (nodemon)
```
Open **http://localhost:3000** and sign in as `user1` / `p455w0rd`.

| Command | Purpose |
|---|---|
| `npm run db:setup` | Create DB + user, migrate, seed |
| `npm run db:migrate` | Re-apply `database/schema.sql` (safe to re-run) |
| `npm run db:seed` | Re-create / reset the two test accounts |
| `npm test` | End-to-end tests (server must be running) |

## Deploying to Render

`.env` is never committed, so Render needs every setting entered in its dashboard. Render does not host MySQL itself, so you also need a **hosted MySQL database**. Free options include Aiven for MySQL, TiDB Cloud Serverless and Railway.

1. **Create a hosted MySQL database.** Note its host, port, database name, user and password, and download its **CA certificate** if one is provided.
2. **Create the Render service.** Use **New → Blueprint** and choose this repo; `render.yaml` sets everything up. Or use **New → Web Service** with:
   - Build command: `npm ci --omit=dev`
   - Start command: `npm run start:render`
   - Health check path: `/healthz`
3. **Set the environment variables** under **Environment**:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `SESSION_SECRET` | a long random string (the Blueprint generates one) |
   | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | from your MySQL provider |
   | `DB_SSL` | `true` |
   | `DB_SSL_CA` | the provider's CA certificate (paste the full PEM text) |

   Do **not** set `DB_ROOT_USER` on Render.
4. **Deploy.** `start:render` creates the tables in `DB_NAME`, then seeds `user1` and `manager1`, then starts the server.

> **Note:** Render's free plan has an ephemeral disk, so uploaded receipts and avatars are lost on every redeploy or restart. Expense records in MySQL are kept. For permanent files, attach a Render Disk (paid) mounted at `/opt/render/project/src/storage`, or move uploads to object storage.

## Testing

### Automated
With the server running:
```bash
npm test
```
The 81 checks cover these areas:
- Registration and login with both test accounts.
- Redirects for signed-out users, and CSRF rejection.
- The four categories, the default date and future-date blocking.
- Amount, date and label validation.
- File type, signature and size checks.
- MySQL persistence: `username`, `submitted_at` and `not-approved` are set automatically, and tampering attempts are ignored.
- Duplicate-submission blocking.
- Dashboard and analytics totals matching MySQL.
- CSV content and formula escaping.
- Per-user data isolation, profile updates, logout and security headers.

The tests delete their own data when they finish; pass `-- --keep` to retain it.

### Manual checklist
1. Visit `/dashboard` while signed out. You should be redirected to `/login`.
2. Sign in as `user1`, then click **Add Expense**.
3. Check that today's date is pre-selected and that future dates can't be picked.
4. Open the category list: it should contain exactly four options.
5. Enter `-5` or `abc` as the amount. It should be rejected.
6. Type some Markdown in the description, then open **Preview**.
7. Drag in a JPG or PNG: the filename and a preview appear. Try **Replace** and **Remove**.
8. Click **Submit Expense**. You should see a spinner, then a success toast and a confirmation dialog.
9. Run the SQL below to confirm the record was saved.
10. Sign in as `manager1`. Their dashboard and CSV must not show `user1`'s data.
11. On **Analytics**, apply filters and click **Export CSV**.

## Verifying records in MySQL

```bash
mysql -u root -p expense_tracker
```
```sql
-- All submitted expenses, newest first
SELECT * FROM expenses ORDER BY submitted_at DESC;

-- Confirm the auto-populated fields
SELECT id, username, label, amount, submitted_at, status
FROM expenses ORDER BY id DESC LIMIT 5;

-- Totals per user and category
SELECT username, category, COUNT(*) AS n, SUM(amount) AS total
FROM expenses GROUP BY username, category;

-- Passwords are bcrypt hashes, never plaintext
SELECT username, LEFT(password_hash, 7) AS hash_prefix, role FROM users;
```
On this machine, without `mysql` on your PATH:
```powershell
& "C:\Users\saiteja\mysql\bin\mysql.exe" -u root -p expense_tracker -e "SELECT * FROM expenses ORDER BY submitted_at DESC;"
```

## Security notes
- **SQL**: every query uses `?` placeholders through `mysql2`. Filter values are whitelisted before they reach the database.
- **Passwords**: bcrypt with cost 12, and a constant-time response for unknown usernames.
- **Login**: rate limited to 10 failed attempts per 15 minutes.
- **Sessions**:
  - Stored server-side in MySQL.
  - The cookie is `HttpOnly` and `SameSite=Lax`, and `Secure` in production.
  - The session ID is regenerated at login.
  - Authenticated pages are sent with `Cache-Control: no-store`.
- **CSRF**: a per-session token is required on every POST. Uploads send it in a header, so it is checked before any file is written.
- **XSS**:
  - EJS escapes all output.
  - The client builds DOM with `textContent`.
  - Markdown previews are sanitised with DOMPurify.
  - A strict CSP (`script-src 'self'`) blocks inline scripts.
- **Uploads**:
  - Allowed types are checked by extension, MIME type and magic bytes.
  - Size is limited, and files get random names outside the web root.
  - Uploads are deleted if validation or the insert fails.
- **Database access**: the app connects as a least-privilege MySQL user, and credentials live only in `.env`, which is git-ignored.

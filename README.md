# Library Book Reservation System

A complete starter project for a campus library using Node.js, Express, EJS, PostgreSQL, pgAdmin and Postman.

## Included features

- Student registration and login with bcrypt password hashing.
- Admin, librarian and student roles.
- Searchable book catalogue with title, author, ISBN, category and shelf location.
- Physical copies tracked separately by unique barcode.
- Add books and copies from the librarian interface or API.
- Reserve an available copy, or join a FIFO waiting list if all copies are unavailable.
- A separate collection step: staff confirm the reservation at the counter, which creates a loan and due date.
- Return processing: staff record the physical return; the copy becomes available or is assigned to the next waiting reservation.
- Duplicate active reservations are blocked.
- Reservation hold deadline, configurable loan period and maximum active loans.
- User and role management, inventory reports, low-stock list, currently issued books and overdue loans.
- JSON REST API and a Postman collection.
- PostgreSQL-backed session storage and a `/health` endpoint.

## Requirements

Install Node.js 20 or newer, PostgreSQL, pgAdmin, and Postman. VS Code is recommended for editing.

## 1. Create the database in pgAdmin

1. Open pgAdmin and connect to your local PostgreSQL server.
2. Right-click **Databases** → **Create** → **Database**.
3. Name it `library_reservation_db` and save.
4. Select that database, open **Tools → Query Tool**, open `sql/schema.sql`, and execute it. Alternatively, use the command in the next section after configuring `.env`.

## 2. Configure the project

Open this folder in VS Code. In the terminal, run:

```bash
npm install
```

Copy `.env.example` to `.env` and update `DB_PASSWORD` to the password for your local PostgreSQL user. Set a long random `SESSION_SECRET` (at least 32 characters). Do not commit `.env` to GitHub.

PowerShell copy command:

```powershell
Copy-Item .env.example .env
```

Example local database settings:

```env
PORT=3000
NODE_ENV=development
APP_URL=http://localhost:3000
SESSION_SECRET=replace-with-a-long-random-secret-of-at-least-32-characters
DB_HOST=localhost
DB_PORT=5432
DB_NAME=library_reservation_db
DB_USER=postgres
DB_PASSWORD=your_actual_postgres_password
DB_SSL=false
LOAN_DAYS=14
MAX_ACTIVE_LOANS=5
RESERVATION_HOLD_HOURS=48
```

If your PostgreSQL role is not `postgres`, use your actual role. Never put angle-bracket placeholders into `.env` as the real password.

## 3. Create tables and seed the administrator

If you did not run `sql/schema.sql` manually in pgAdmin, run:

```bash
npm run db:init
npm run db:seed
```

Default local administrator credentials:

- Email: `admin@library.local`
- Password: `ChangeMe123!`

Change the seed password before first seed by setting `SEED_ADMIN_PASSWORD` and optionally `SEED_ADMIN_EMAIL` in `.env`. If the default account has already been created, changing the seed environment variable will not change its existing password because the seed uses `ON CONFLICT DO NOTHING`. For a deployed system, create/reset administrator credentials securely and remove default credentials.

## 4. Run the app

```bash
npm run dev
```

Open `http://localhost:3000`. For a normal start, use `npm start`. Check the database connection at `http://localhost:3000/health`.

## 5. Recommended manual test sequence

1. Log in with the seeded administrator.
2. Open **Add a book** and create a title with 2 physical copies.
3. Log out and create a student account.
4. Find the book and reserve it. The reservation should be `ready` if a copy is available.
5. Log in as the administrator/librarian, open **Reservations**, and click **Confirm collection** after the student physically arrives.
6. Open **Loans and returns** and check the due date.
7. Record the return after the physical book is returned. The copy becomes available, or is allocated to the next waiting reservation.
8. Try reserving when no copies are available to test the waiting queue.

## 6. Postman setup

1. Open Postman → **Import**.
2. Import `postman/Library_Reservation_System.postman_collection.json`.
3. Keep `baseUrl` as `http://localhost:3000` for local testing.
4. Send **Health check** first.
5. Send **Login admin**. Postman should keep the `library.sid` cookie for subsequent requests. Use **Login student** when testing student-only actions; logins replace the active session cookie.
6. Send **List books** and **List categories**.
7. To test reservation, log in as a student, set `bookId` to an actual book ID, and send **Reserve a book**.
8. To confirm collection or return a book, log in as admin/librarian and use the actual `reservationId` or `loanId` returned by the API.

Important API endpoints:

| Method | Endpoint | Access |
|---|---|---|
| GET | `/health` | Public health check |
| POST | `/api/auth/register` | Public; creates student |
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/logout` | Logged-in user |
| GET | `/api/auth/me` | Logged-in user |
| GET | `/api/books` | Public |
| GET | `/api/books/:id` | Public |
| POST | `/api/books` | Admin/librarian |
| PUT | `/api/books/:id` | Admin/librarian |
| POST | `/api/books/:id/copies` | Admin/librarian |
| POST | `/api/books/:id/reservations` | Logged-in user |
| GET | `/api/reservations` | Student sees own; staff sees all |
| POST | `/api/reservations/:id/cancel` | Owner or staff |
| POST | `/api/reservations/:id/collect` | Admin/librarian |
| GET | `/api/loans` | Student sees own; staff sees all |
| POST | `/api/loans/:id/return` | Admin/librarian |
| GET | `/api/categories` | Public |
| POST | `/api/categories` | Admin/librarian |
| GET | `/api/reports/summary` | Admin/librarian |
| GET | `/api/users` | Admin |
| PATCH | `/api/users/:id/role` | Admin |

API requests that require authentication use the session cookie created by `/api/auth/login`; this starter does not use bearer tokens.

## 7. Deploying

For a hosted deployment, use a managed PostgreSQL database and a Node.js hosting provider that supports persistent environment variables. Set `DATABASE_URL` to the provider's PostgreSQL connection string, set `DB_SSL=true` if the provider requires TLS, and set `NODE_ENV=production`, `PORT` (usually provided by the host), `APP_URL`, and a strong unique `SESSION_SECRET`. If the provider requires a CA certificate, configure TLS according to that provider rather than blindly disabling certificate verification. Run `sql/schema.sql` once against the production database or use `npm run db:init` from a controlled deployment step. Run `npm run db:seed` only if you intentionally want the initial admin account created.

Set the host start command to `npm start`. Ensure the hosting platform can reach the database. Test `/health`, login, catalogue search, reservation, collection, and return on the deployed URL. Do not use a development database for production.

## Security and operational notes

- `.env` is excluded from Git; never publish real credentials.
- Default admin credentials are for local setup only and must not remain in production.
- Staff should confirm collection only when the physical book has been handed to the student, and record a return only after receiving the copy.
- This is a practical coursework starter, not a formally audited library system. Before public production use, add CSRF protection to browser forms, email verification/password reset, account lockout and audit logs, backup/restore procedures, and a controlled admin password-reset process. Put it behind HTTPS.
- No automatic background job expires old reservations in the background. Expired holds are released when staff try to collect that reservation; for a real deployment, add a scheduled expiry job.

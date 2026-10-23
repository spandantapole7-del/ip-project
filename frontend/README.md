# Hostel Survival Manager

Hostel Survival Manager is a full-stack app for student budgeting, expense tracking, and hostel checklists.

## Stack

- Frontend: HTML, CSS, and browser JavaScript
- Backend: Node.js and Express
- Database: SQLite (built into Node.js)

## Run locally

1. Use Node.js 24 or newer.
2. Install backend and frontend dependencies:
   ```sh
   npm --prefix backend install
   npm --prefix frontend install
   ```
3. Start the backend in one terminal:
   ```sh
   npm --prefix backend start
   ```
4. Start the frontend dev server in another terminal:
   ```sh
   npm --prefix frontend run dev
   ```
5. Open <http://localhost:5173>.

No database server is required. On startup, the backend creates `backend/data/hostel.db` and its `hsm_` tables automatically. Copy `backend/.env.example` to `backend/.env` only if you want to change the port, database file, or session length.

The Vite development server serves `frontend/` on port 5173 and proxies `/api` requests to the Express backend on port 5000. Signup and login use salted password hashes and an authenticated API token; each user's budget, expenses, and checklist are stored separately in SQLite.

## Project layout

- `frontend/` contains the static pages, styles, and browser scripts.
- `backend/` contains the Express API, SQLite database, and environment configuration.

The backend health endpoint is `GET /api/health`.

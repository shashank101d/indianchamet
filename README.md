# ChillChat — Setup Guide

## Project Structure
```
chillchat/
├── backend/
│   ├── main.py          ← FastAPI app (run this)
│   ├── database.py      ← DB connection
│   ├── models.py        ← Tables
│   ├── schemas.py       ← Data validation
│   ├── auth.py          ← JWT login/signup
│   ├── chat.py          ← WebSocket manager
│   ├── payments.py      ← Stripe logic
│   ├── requirements.txt ← Python packages
│   └── .env.example     ← Copy to .env and fill in
└── frontend/
    ├── index.html       ← Main chat page
    ├── store.html       ← Coin store
    ├── css/style.css    ← All styles
    └── js/
        ├── app.js       ← Auth (shared)
        ├── chat.js      ← Chat logic
        └── payments.js  ← Stripe payments
```

---

## Step 1 — Configure environment

```bash
cd backend
cp .env.example .env
```
Open `.env` and fill in:
- `DATABASE_URL` — from Railway or Supabase (see below)
- `SECRET_KEY` — run: `python -c "import secrets; print(secrets.token_hex(32))"`
- `STRIPE_SECRET_KEY` — from stripe.com → Developers → API Keys
- `STRIPE_WEBHOOK_SECRET` — from Stripe Webhooks dashboard

Also open `frontend/js/payments.js` and replace `pk_test_YOUR_PUBLISHABLE_KEY_HERE`
with your Stripe *publishable* key.

And open `frontend/js/app.js` and set `API_URL` to wherever your backend runs.

---

## Step 2 — Get a free database

**Railway (easiest):**
1. Go to railway.app → New Project → PostgreSQL
2. Click the DB → Connect tab → copy "Postgres Connection URL"
3. Paste into `.env` as `DATABASE_URL`

**Supabase (alternative):**
1. supabase.com → New project → Settings → Database → copy connection string
2. Replace `[YOUR-PASSWORD]` with your DB password

---

## Step 3 — Run the backend

```bash
cd backend
pip install -r requirements.txt
python main.py
```

Server starts at http://localhost:8000
API docs at http://localhost:8000/docs

---

## Step 4 — Open the frontend

```bash
cd frontend
python -m http.server 3000
```

Then open http://localhost:3000 in your browser.

Or just open `frontend/index.html` directly (double-click).

---

## Step 5 — Deploy (free)

**Backend → Railway:**
1. Push code to GitHub
2. railway.app → New Project → Deploy from GitHub
3. Select repo, set root directory to `backend`
4. Add all `.env` variables in Railway's Variables tab
5. Railway gives you a URL like `https://chillchat-xxx.up.railway.app`

**Frontend → Netlify (free):**
1. netlify.com → drag & drop the `frontend` folder
2. OR: connect GitHub repo, set publish directory to `frontend`

**After deploying:**
- Update `API_URL` in `frontend/js/app.js` to your Railway URL
- Update Stripe webhook URL to `https://your-railway-url/api/payments/webhook`

---

## Bug fixes vs original code

| # | Bug | Fix |
|---|-----|-----|
| 1 | `@app.on_event("startup")` deprecated | Replaced with `lifespan` context manager |
| 2 | JWT `sub` stored as int, decoded as str | Always store/read as string |
| 3 | WebSocket token passed as header (not supported) | Pass as `?token=` query param |
| 4 | `stripe-signature` header alias wrong | Added `alias="stripe-signature"` |
| 5 | `manager.connect_already_accepted()` missing | Added method to `ConnectionManager` |
| 6 | `manager.disconnect()` signature mismatch | Made `user_id`/`username` optional |
| 7 | Store.html Stripe script URL had extra backticks | Fixed to proper HTTPS URL |
| 8 | Frontend JS files were empty stubs | All 3 files fully implemented |

---

## Stripe test cards

When testing payments use Stripe's test card numbers:
- **Success:** 4242 4242 4242 4242 — any future date — any CVC
- **Decline:** 4000 0000 0000 0002

# Dive Centre Fuel Log

A Telegram bot + web dashboard for logging boat fuel from **FUEL CHIT** photos, with
an Excel export formatted exactly like the Dive Centre fuel sheet.

- Send a photo of a fuel chit to the Telegram bot.
- It OCRs the chit (via **OCR.space**, Engine 3), reads every boat that has a written quantity,
  detects Petrol vs Diesel from the fixed boat list, and logs each row with its date.
- One chit logs several **Coral Boat** entries at once. Only Coral boats are tracked here;
  the Maafushivaru (Outrigger) section is ignored.
- A password-protected web dashboard lets you view logs live, add/edit/correct entries,
  filter by date range, switch Petrol/Diesel sheets, and export to Excel/PDF or print.
- Excel export reproduces the Dive Centre layout: **PETROL** and **DIESEL** side by side
  (Date · Boat Name · Qty · Unit) with a per-column **TOTAL**, plus a second **Boat Totals**
  sheet summing litres per boat.
- The **same chit photo twice is ignored**, and a row exactly matching an existing
  date+boat+quantity is skipped.
- Chit photos auto-delete from Supabase Storage after **60 days**; the logged numbers are kept.

## The boats (fixed template)

| Section | Petrol | Diesel |
|---|---|---|
| Coral Boat | Sea Explorer, Jetski, Gonzo | Chill Time, Fish Stalker, Arya |

Only **Coral Boat** boats are logged. The Maafushivaru (Outrigger) section of the chit is
ignored, even if it appears in the same photo.

Each boat is always Petrol or Diesel, so the bot uses this mapping rather than relying on
OCR reading the P/D column. If a boat is renamed or added, update `BOATS` in `src/parser.js`
(and `BOATS`/`PETROL_BOATS` in `public/app.js`).

## How dates are picked

The date written on the Coral section of the chit is used (`dd/mm/yy`). If the handwritten date can't be
read, the bot falls back to the photo's EXIF capture date, then to today (and flags it).
Send the photo as a **File** (📎 → File) to preserve the photo's date metadata. You can always
fix a date in the dashboard.

## Setup

### 1. OCR.space API key
Sign up at https://ocr.space/ocrapi and set `OCR_SPACE_API_KEY`. Engine 3 is used for reading chits.

### 2. Supabase
1. Create a project at https://supabase.com.
2. Open **SQL Editor → New query**, paste `supabase.sql`, and run it (creates `fuel_logs`).
3. **Storage → New bucket** → name `fuel-chits`, Public bucket **ON**.
4. **Project Settings → API**: copy the **Project URL** (`SUPABASE_URL`) and the
   **service_role** key (`SUPABASE_SERVICE_KEY`). Keep the service key server-side only.

### 3. Telegram bot
Create a bot with BotFather, copy the token into `BOT_TOKEN`.

### 4. Deploy on Render
1. Push this repo to GitHub.
2. Create a **Web Service** on Render from the repo (config in `render.yaml`).
3. Set the environment variables from `.env.example`. Set `WEBHOOK_URL` and `DASHBOARD_URL`
   to your Render URL. The webhook is registered automatically on boot.
4. Open the dashboard at your Render URL and log in with `ADMIN_USER` / `ADMIN_PASSWORD`.

## Commands
`/today` `/latest` `/petrol` `/diesel` `/boats` `/week` `/month` `/stats` `/dashboard` `/help`
plus quick-access buttons under `/start`.

## Local dev
```
npm install
cp .env.example .env   # fill in values
npm start
```

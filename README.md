# Business Manager (offline-first)

Shops/tenants, deposits, rent collection and Roz Namcha ledger for multiple businesses.

## Run
    npm start            # http://localhost:3000   (Node 22.13+; no npm install needed)

Open it in Chrome/Edge/Safari and use "Install app" / "Add to Home Screen" for an offline app.

## How data is stored
- **On the device:** IndexedDB is the primary store. All reads/writes happen locally, so the app
  works with no network and even with the server stopped.
- **On the server:** `data/bizmanager.db` (SQLite). The browser syncs in the background
  (push local changes, pull new ones; last-write-wins per record, deletes are soft).
- The sidebar shows sync state. Backup/Restore JSON and CSV exports are under Export / CSV.

## Use from your phone / another PC on the same Wi-Fi
    HOST=0.0.0.0 npm start
Then open `http://<your-mac-ip>:3000` on the phone and sign in with the admin account.
Service workers/PWA install need HTTPS or localhost, so on a LAN IP the app syncs but won't
install offline — put it behind HTTPS (e.g. Tailscale or Caddy) if you want that.

## Layout
    public/    frontend (index.html, css, js/store.js, js/sync.js, js/app.js, sw.js, manifest)
    server/    server.js (static files + /api/sync, node:sqlite)
    data/      SQLite database (git-ignored) — back this folder up
    legacy/    the original single-file app

## Deploy to Vercel (free)
1. `npm i -g vercel` then `vercel login`
2. In this folder run `vercel` (accept the defaults) to create the project.
3. Vercel dashboard → your project → **Storage** → create a **Neon Postgres** database (free) and connect it to the project. This adds `DATABASE_URL`.
4. Project → **Settings → Environment Variables** → add `ADMIN_PASSWORD` (your admin password) and optionally `ADMIN_USER` (default `admin`).
5. `vercel --prod` — open the URL on any device. First visit shows the sign-in screen; after that it works offline.

`api/` is the Vercel version of the server (Postgres). `server/` is the local SQLite version; both speak the same sync protocol.

## Admin login
- **Local server:** the first time you open the app **on the server computer** it asks you to create the admin
  username/password (stored hashed in `data/admin.json`). Other devices can only sign in, not create it.
  Forgot it? Stop the server, delete `data/admin.json`, start again.
- **Vercel:** the admin is set by the `ADMIN_USER` / `ADMIN_PASSWORD` environment variables. Changing the password
  there signs every device out.
- Sessions last 30 days and are kept on the device, so the app keeps working offline after one sign-in.
  Signing in itself needs the server. 8 wrong attempts blocks an address for 15 minutes.

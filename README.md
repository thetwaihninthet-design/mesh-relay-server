# Mesh App — Relay Server

Tiny relay for the Mesh App's **Internet Bridge** feature. It lets a
message travel far (e.g. Singapore → Myanmar) where Bluetooth mesh
alone can never reach. No dependencies — only the Node.js standard
library.

## How it works

```
Phone A (SG, no internet) --mesh--> Bridge phone B (SG, internet)
B --HTTPS--> this server --HTTPS--> Bridge phone C (MM, internet)
C --mesh--> Phone D (MM, no internet)
```

- `POST /send` — a bridge phone uploads one encrypted envelope
  addressed to a far-away ID. Stored in memory until asked for.
- `POST /receive` — a bridge phone asks for mail for itself and for
  every ID it can reach over its local mesh. Matching envelopes are
  returned **and removed** (handed out once).
- `GET /health` — liveness check: `{ ok, queued, uptimeSeconds }`.

The server **never sees plain text**: the payload is the same
AES-256-GCM ciphertext the mesh carries. No accounts, no Firebase,
no database — envelopes live only in memory, old mail (over 24
hours) is dropped, and everything is forgotten on restart.

## Run it

```bash
node relay-server.js            # listens on port 3000
PORT=8080 node relay-server.js  # or any port you like
```

Check it: `curl http://localhost:3000/health`

Needs Node.js 18 or newer. Nothing to install (`npm install` is
not needed — there are no dependencies).

## Hosting

The server must be reachable from **both** countries, so it has to
live on the internet:

- Easiest free options: Render, Railway or Fly.io free tier — deploy
  this one file and set `PORT` from the platform.
- Or any cheap VPS with Node.js 18+ and an open port.
- Quick local test: run it on your own computer and point the app's
  Relay Server URL at `http://<computer-ip>:3000` (the app allows
  cleartext HTTP for a local test; use HTTPS with a real domain for
  anything public).

Without a hosted server the Bridge does nothing — the app alone
cannot send a message across the sea. That is an honest limit of
this version, not a bug.

/**
 * Mesh App — Relay Server (Internet Bridge)
 * ==========================================
 * A tiny relay for the Mesh App's Internet Bridge feature. It lets a
 * message travel far — for example from Singapore to Myanmar — where
 * Bluetooth mesh alone can never reach:
 *
 *   Phone A (SG, no internet) --mesh--> Bridge phone B (SG, internet)
 *   B --HTTPS--> this server --HTTPS--> Bridge phone C (MM, internet)
 *   C --mesh--> Phone D (MM, no internet)
 *
 * What this server does:
 * - POST /send    — a bridge phone uploads one encrypted envelope that
 *                   is addressed to a far-away ID. The envelope is
 *                   stored until somebody asks for it.
 * - POST /receive — a bridge phone asks for mail addressed to itself
 *                   and to every ID it can reach over its local mesh.
 *                   Matching envelopes are returned AND removed
 *                   (handed out once, so nobody gets the same message
 *                   twice).
 * - GET  /health  — liveness check: { ok, queued, uptimeSeconds }.
 *
 * What this server does NOT do (on purpose):
 * - It never decrypts anything. The payload is the same AES-256-GCM
 *   ciphertext the mesh itself carries — the server only ever sees
 *   encrypted envelopes plus the from/to ID codes. It cannot read
 *   your messages.
 * - No accounts, no Firebase, no database. Envelopes live only in
 *   memory and are forgotten when the server restarts. Old mail
 *   (over 24 hours) and the oldest mail over the cap are dropped.
 * - It does not push anything. Bridge phones poll it every few
 *   seconds, so delivery is store-and-forward (a few seconds of
 *   delay), not instant.
 *
 * Run it:
 *   node relay-server.js            (listens on port 3000)
 *   PORT=8080 node relay-server.js  (or any port you like)
 *
 * Hosting — the server must be reachable from BOTH countries, so it
 * has to live on the internet, not on a home phone:
 * - Easiest free options: Render, Railway or Fly.io free tier
 *   (deploy this one file; set PORT from the platform).
 * - Or any cheap VPS with Node.js 18+ and an open port.
 * - For a quick local test, run it on your own computer and point
 *   the app's Relay Server URL at http://<computer-ip>:3000
 *   (the app allows cleartext HTTP for a local test server; use
 *   HTTPS with a real domain for anything public).
 *
 * No dependencies: only the Node.js standard library (http).
 * Tested with Node.js 18+.
 */

const http = require("http");

const PORT = Number(process.env.PORT || 3000);

// Max envelopes kept in memory, and max age before old mail is dropped.
const MAX_STORED = 5000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// destination ID -> Map(messageId -> envelope)
const mailboxes = new Map();
let storedCount = 0;

function totalStored() {
  return storedCount;
}

/** Drop mail older than MAX_AGE_MS, and the oldest mail over the cap. */
function prune() {
  const now = Date.now();
  for (const [toId, box] of mailboxes) {
    for (const [id, env] of box) {
      if (now - (env.timestamp || 0) > MAX_AGE_MS) {
        box.delete(id);
        storedCount--;
      }
    }
    if (box.size === 0) mailboxes.delete(toId);
  }
  // Over the cap: drop the oldest envelopes first.
  while (storedCount > MAX_STORED) {
    let oldestTo = null;
    let oldestId = null;
    let oldestTs = Infinity;
    for (const [toId, box] of mailboxes) {
      for (const [id, env] of box) {
        if ((env.timestamp || 0) < oldestTs) {
          oldestTs = env.timestamp || 0;
          oldestTo = toId;
          oldestId = id;
        }
      }
    }
    if (oldestTo === null) break;
    mailboxes.get(oldestTo).delete(oldestId);
    storedCount--;
    if (mailboxes.get(oldestTo).size === 0) mailboxes.delete(oldestTo);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        // 1 MB cap: an envelope is a text message, never a file.
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, {
        ok: true,
        queued: totalStored(),
        uptimeSeconds: Math.floor(process.uptime()),
      });
    }

    if (req.method === "POST" && req.url === "/send") {
      const env = JSON.parse(await readBody(req));
      if (!env || typeof env.id !== "string" || typeof env.toId !== "string") {
        return sendJson(res, 400, { ok: false, error: "missing id or toId" });
      }
      prune();
      let box = mailboxes.get(env.toId);
      if (!box) {
        box = new Map();
        mailboxes.set(env.toId, box);
      }
      if (!box.has(env.id)) {
        // De-duplicate by message id: the same packet uploaded twice
        // (e.g. by two bridge phones) is only stored once.
        box.set(env.id, env);
        storedCount++;
      }
      return sendJson(res, 200, { ok: true, queued: totalStored() });
    }

    if (req.method === "POST" && req.url === "/receive") {
      const body = JSON.parse(await readBody(req));
      const toIds = Array.isArray(body.toIds) ? body.toIds : [];
      const out = [];
      for (const toId of toIds) {
        if (typeof toId !== "string") continue;
        const box = mailboxes.get(toId);
        if (!box) continue;
        for (const env of box.values()) out.push(env);
        // Handed out once: remove what we just gave away.
        storedCount -= box.size;
        mailboxes.delete(toId);
      }
      return sendJson(res, 200, { ok: true, messages: out });
    }

    return sendJson(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`Mesh relay server listening on port ${PORT}`);
  console.log(`Health check: curl http://localhost:${PORT}/health`);
});

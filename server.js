'use strict';

const express  = require('express');
const { ExpressPeerServer } = require('peer');
const http     = require('http');
const path     = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const PORT       = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const PEER_PATH  = '/peerjs';

// Metered.ca (Open Relay) TURN credentials — sign up free at metered.ca,
// create an "app", and set these two env vars:
//   METERED_APP_NAME = the subdomain part of <name>.metered.live
//   METERED_API_KEY  = your API key from the Metered dashboard
const METERED_APP_NAME = process.env.METERED_APP_NAME || '';
const METERED_API_KEY  = process.env.METERED_API_KEY  || '';

// Fallback if Metered isn't configured or its API is unreachable —
// STUN-only, so direct (same-network) connections still work, but cross-NAT
// connections will likely fail without a TURN relay.
const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

// ── App ───────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── PeerJS signaling ──────────────────────────────────────────────────────────
// Render (and most reverse proxies) terminate TLS themselves and forward
// plain HTTP to your process, so we always create an http server here.
// The browser connects over wss:// (port 443) to the Render URL; Render
// proxies it to us over ws:// on PORT.  That's why secure=true in the
// client config even though the Node process itself is plain HTTP.
const peerServer = ExpressPeerServer(server, {
  path:            '/',
  key:             'peerjs',
  allow_discovery: false,
  proxied:         true,   // trust X-Forwarded-* from Render's proxy
});

app.use(PEER_PATH, peerServer);

peerServer.on('connection', (client) => {
  console.log(`[peer] connected:    ${client.getId()}`);
});
peerServer.on('disconnect', (client) => {
  console.log(`[peer] disconnected: ${client.getId()}`);
});

// ── /peer-config.js ───────────────────────────────────────────────────────────
// Served to the browser so it knows where to reach the PeerJS signaling server.
// Key insight for Render / any HTTPS host:
//   - host  = the public hostname (no port in URL)
//   - port  = 443  (standard HTTPS/WSS — Render listens here publicly)
//   - secure = true (use wss://)
//   - path  = '/peerjs'
app.get('/peer-config.js', (req, res) => {
  let host, port, secure;

  if (PUBLIC_URL) {
    try {
      const u = new URL(PUBLIC_URL);
      host   = u.hostname;
      // If the URL has no explicit port, use the protocol default (443 / 80)
      port   = u.port ? parseInt(u.port) : (u.protocol === 'https:' ? 443 : 80);
      secure = u.protocol === 'https:';
    } catch (e) {
      host = req.hostname; port = PORT; secure = false;
    }
  } else {
    // No PUBLIC_URL set — derive from the incoming request.
    // IMPORTANT: behind a proxy (Render, Railway, Heroku, nginx, etc.) the
    // browser always talks to the public edge on 443/80, never to the
    // internal PORT the Node process is bound to. Using PORT here would
    // tell the client to connect to a port that isn't publicly reachable.
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const isProxied = !!req.headers['x-forwarded-proto'];
    host   = req.hostname;
    port   = isProxied ? (proto === 'https' ? 443 : 80) : PORT;
    secure = proto === 'https';
  }

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.send(
    `var PEER_HOST   = ${JSON.stringify(host)};\n` +
    `var PEER_PORT   = ${port};\n` +
    `var PEER_PATH   = ${JSON.stringify(PEER_PATH)};\n` +
    `var PEER_SECURE = ${secure};\n`
  );
});

// ── /turn-credentials ───────────────────────────────────────────────────────
// Proxies Metered's TURN credentials API so the API key never reaches the
// browser. Credentials are cached briefly in memory to avoid re-fetching on
// every single room join (Metered's free tier has a request quota).
let iceCache = { servers: null, fetchedAt: 0 };
const ICE_CACHE_MS = 10 * 60 * 1000; // 10 minutes

app.get('/turn-credentials', async (_req, res) => {
  const now = Date.now();
  if (iceCache.servers && (now - iceCache.fetchedAt) < ICE_CACHE_MS) {
    return res.json({ iceServers: iceCache.servers });
  }

  if (!METERED_APP_NAME || !METERED_API_KEY) {
    console.warn('[turn] METERED_APP_NAME / METERED_API_KEY not set — falling back to STUN-only.');
    return res.json({ iceServers: FALLBACK_ICE_SERVERS });
  }

  try {
    const url = `https://${METERED_APP_NAME}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Metered API responded ${r.status}`);
    const iceServers = await r.json();
    iceCache = { servers: iceServers, fetchedAt: now };
    res.json({ iceServers });
  } catch (e) {
    console.error('[turn] failed to fetch Metered credentials:', e.message);
    // Serve last-known-good credentials if we have any, even if stale,
    // rather than dropping straight to STUN-only.
    res.json({ iceServers: iceCache.servers || FALLBACK_ICE_SERVERS });
  }
});

// ── Health check (prevents Render from thinking the app is down) ──────────────
app.get('/healthz', (_req, res) => res.send('ok'));

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  const display = PUBLIC_URL || `http://localhost:${PORT}`;
  console.log(`\n🎮  Rebus Rumble  →  ${display}`);
  console.log(`📡  PeerJS signal →  ${display}${PEER_PATH}`);
  console.log(`🩺  Health check  →  ${display}/healthz\n`);
});

'use strict';

const express  = require('express');
const { ExpressPeerServer } = require('peer');
const http     = require('http');
const path     = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const PORT       = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const PEER_PATH  = '/peerjs';

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
    // Local dev: derive from the incoming request
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    host   = req.hostname;
    port   = PORT;
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

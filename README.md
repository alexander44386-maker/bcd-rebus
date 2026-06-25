🎮 Rebus Rumble — Self-Hosted Multiplayer
A real-time multiplayer picture-puzzle game running on your own server so
connections are reliable. No more "Could not reach that room" errors from the
overloaded public PeerJS cloud.
---
How it works
```
Browser A (host)  ──┐
                    ├── PeerJS signaling (your server) ──► WebRTC peer-to-peer data channel
Browser B (guest) ──┘
```
Your server only handles the handshake (signaling). Once connected, all
game data flows directly between browsers via WebRTC. The server is very
lightweight — it handles almost no ongoing traffic.
---
Run locally (fastest way to test)
```bash
npm install
npm start
```
Open http://localhost:3000 in two different browsers (or two tabs — but
for a real test, use two different devices on the same network).
---
Deploy to Render (free, recommended)
Push this folder to a GitHub repo.
Go to https://render.com → New → Web Service.
Connect your repo, set:
Build command: `npm install`
Start command: `node server.js`
Environment variable: `PUBLIC_URL` = `https://your-app.onrender.com`
Click Create Web Service.
Render gives you a free HTTPS URL. Share it — anyone on the internet can play.
---
Deploy to Railway
Push to GitHub.
Go to https://railway.app → New Project → Deploy from GitHub repo.
Add environment variable: `PUBLIC_URL` = `https://your-app.up.railway.app`
Railway auto-detects Node.js and deploys.
---
Deploy to a VPS / DigitalOcean / Hetzner
```bash
# On the server
git clone <your-repo>
cd rebus-rumble
npm install

# With PM2 (keeps it running after logout)
npm install -g pm2
PORT=3000 PUBLIC_URL=https://yourdomain.com pm2 start server.js --name rebus

# Point nginx to port 3000 and add SSL via certbot
```
Minimal nginx config:
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```
---
TURN server setup (required for cross-network play)
Signaling alone (the part this server handles) only lets two browsers find
each other — it doesn't guarantee they can open a direct connection. When
host and guest are on different networks (different WiFi, mobile data,
behind a NAT/firewall — i.e. almost always in the real world), a TURN relay
is what actually gets the connection through. This app proxies TURN
credentials from Metered (the same Open Relay
project, now account-based) so they stay fresh and your API key never ships
to the browser.
Sign up free at https://www.metered.ca → create an "app".
From the dashboard, grab:
App name — the subdomain part of `<name>.metered.live`
API key
Set two more environment variables (same place you set `PUBLIC_URL`):
```
   METERED_APP_NAME = <name>
   METERED_API_KEY  = <your key>
   ```
Redeploy / restart. The server will fetch and cache TURN credentials at
`/turn-credentials`, and the client uses those instead of any hardcoded
credentials.
Without these set, the app falls back to STUN-only — fine for same-network
testing, but cross-network connections will likely fail.
---
Environment variables
Variable	Default	Description
`PORT`	`3000`	Port the server listens on
`PUBLIC_URL`	(auto-detected)	Full public URL (set on any host)
`METERED_APP_NAME`	(none)	Your Metered app subdomain — enables TURN
`METERED_API_KEY`	(none)	Your Metered API key — enables TURN
---
Troubleshooting
Problem	Fix
"Could not reach that room" (same network)	Make sure the host's tab is still open; check `PUBLIC_URL` is set correctly
"Could not reach that room" (different networks/devices)	You need a working TURN relay — set `METERED_APP_NAME` / `METERED_API_KEY` (see above)
Connection works locally but not remotely	Set `PUBLIC_URL` to your real domain with `https://`
Players behind corporate firewall	Confirm Metered credentials are set; corporate firewalls especially need a working TURN relay

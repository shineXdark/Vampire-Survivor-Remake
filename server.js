#!/usr/bin/env node
// server.js — Void Survivors v3.3.0
// ─────────────────────────────────────────────────────────
// HOW TO RUN:
//   Option A) Double-click start-game.bat  (Windows — recommended)
//   Option B) node server.js               (any terminal)
//   Option C) npm start                    (any terminal)
// ─────────────────────────────────────────────────────────

'use strict';

const express  = require('express');
const http     = require('http');
const WebSocket = require('ws');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const os       = require('os');

const PORT = parseInt(process.env.PORT || '3000', 10);

// ── Smart public directory detection ────────────────────────
// Works no matter where you run this file from.
// Checks for index.html next to server.js first, then ./public/
function findPublicDir() {
  const serverDir = path.dirname(fs.realpathSync(process.argv[1] || __filename));
  const candidates = [
    path.join(serverDir, 'public'),   // ./public/index.html
    serverDir,                         // ./index.html  (flat layout)
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      console.log(`  ✓ Game files found at: ${dir}`);
      return dir;
    }
  }
  // Neither found — print a helpful error
  console.error('\n  ✗ ERROR: Could not find index.html!');
  console.error('  Make sure index.html is in the same folder as server.js,');
  console.error('  or in a "public" subfolder next to server.js.\n');
  process.exit(1);
}

const PUBLIC_DIR = findPublicDir();

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.static(PUBLIC_DIR));
app.get('/ping',           (_req, res) => res.status(200).send('pong'));
app.get('/',               (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/api/server-info', (_req, res) => res.json({ ip: getLANIP(), port: PORT, version: '3.3.0' }));

// ── LAN IP Detection ─────────────────────────────────────
function getLANIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// ── Lobby State ───────────────────────────────────────────
const lobbies = new Map();
const clients = new Map();

function createLobby(hostId, config) {
  const id = Math.random().toString(36).substring(2,8).toUpperCase();
  const lobby = {
    id,
    config: {
      mapIndex:    config.mapIndex    ?? 3,
      waveSpeed:   config.waveSpeed   ?? 'normal',
      maxPlayers:  config.maxPlayers  ?? 4,
      friendlyFire:config.friendlyFire?? false,
      difficulty:  config.difficulty  ?? 'normal',
    },
    players: new Map(),
    state: 'waiting',
    tickInterval: null,
    tick: 0,
    sharedXP: 0,
    sharedXPNext: 20,
    surrenderVote: null,
    surrenderTimeout: null,
  };
  lobbies.set(id, lobby);
  return lobby;
}

function getLobbyList() {
  return [...lobbies.values()]
    .filter(l => l.state === 'waiting')
    .map(l => ({
      id:          l.id,
      playerCount: l.players.size,
      maxPlayers:  l.config.maxPlayers,
      map:         ['Void Plains','Cursed Ruins','Crystal Cavern','Random'][l.config.mapIndex] || '?',
      waveSpeed:   l.config.waveSpeed,
      difficulty:  l.config.difficulty,
      hostName:    [...l.players.values()].find(p => p.isHost)?.name || 'Unknown',
    }));
}

function broadcast(lobby, msg, excludeId = null) {
  const d = JSON.stringify(msg);
  for (const p of lobby.players.values())
    if (p.id !== excludeId && p.ws.readyState === WebSocket.OPEN) p.ws.send(d);
}
function broadcastAll(lobby, msg) { broadcast(lobby, msg, null); }
function sendTo(ws, msg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function getPlayerList(lobby) {
  return [...lobby.players.values()].map(p => ({
    id: p.id, name: p.name, charIdx: p.charIdx,
    isHost: p.isHost, ready: p.ready, dead: p.dead,
  }));
}

function pushLobbyListToWatchers() {
  const list = getLobbyList();
  const d = JSON.stringify({ type: 'LOBBY_LIST', lobbies: list });
  for (const c of clients.values())
    if (c.watchingLobbies && c.ws.readyState === WebSocket.OPEN) c.ws.send(d);
}

function startGameTick(lobby) {
  lobby.tick = 0;
  lobby.tickInterval = setInterval(() => {
    if (lobby.state !== 'ingame') { clearInterval(lobby.tickInterval); return; }
    lobby.tick++;
    broadcastAll(lobby, { type: 'GAME_TICK', tick: lobby.tick });
    const alive = [...lobby.players.values()].filter(p => !p.dead).length;
    if (alive === 0 && lobby.players.size > 0) {
      broadcastAll(lobby, { type: 'GAME_OVER', reason: 'all_dead' });
      lobby.state = 'ended';
      clearInterval(lobby.tickInterval);
    }
  }, 50);
}

// ── WebSocket Handler ─────────────────────────────────────
wss.on('connection', (ws) => {
  const clientId = uuidv4();
  clients.set(ws, { id: clientId, lobbyId: null, ws, watchingLobbies: false });
  sendTo(ws, { type: 'CONNECTED', clientId, serverIP: getLANIP(), port: PORT });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const client = clients.get(ws);
    if (!client) return;

    switch (msg.type) {
      case 'GET_LOBBIES':
        sendTo(ws, { type: 'LOBBY_LIST', lobbies: getLobbyList() });
        break;

      case 'WATCH_LOBBIES':
        client.watchingLobbies = true;
        sendTo(ws, { type: 'LOBBY_LIST', lobbies: getLobbyList() });
        break;

      case 'CREATE_LOBBY': {
        const lobby = createLobby(clientId, msg.config || {});
        client.lobbyId = lobby.id;
        const p = {
          id: clientId, name: msg.playerName || 'Host',
          charIdx: msg.charIdx ?? 0, isHost: true, ready: true, dead: false, ws,
        };
        lobby.players.set(clientId, p);
        sendTo(ws, { type: 'LOBBY_CREATED', lobbyId: lobby.id, config: lobby.config, players: getPlayerList(lobby) });
        pushLobbyListToWatchers();
        break;
      }

      case 'JOIN_LOBBY': {
        const lobby = lobbies.get(msg.lobbyId);
        if (!lobby)                                   { sendTo(ws, { type: 'ERROR', message: 'Lobby not found' });   break; }
        if (lobby.state !== 'waiting')                { sendTo(ws, { type: 'ERROR', message: 'Game already started' }); break; }
        if (lobby.players.size >= lobby.config.maxPlayers) { sendTo(ws, { type: 'ERROR', message: 'Lobby full' });   break; }
        client.lobbyId = lobby.id;
        const p = {
          id: clientId, name: msg.playerName || 'Player',
          charIdx: msg.charIdx ?? 0, isHost: false, ready: false, dead: false, ws,
        };
        lobby.players.set(clientId, p);
        sendTo(ws, { type: 'JOINED_LOBBY', lobbyId: lobby.id, config: lobby.config, players: getPlayerList(lobby) });
        broadcast(lobby, { type: 'PLAYER_JOINED', player: { id: clientId, name: p.name, charIdx: p.charIdx }, players: getPlayerList(lobby) }, clientId);
        pushLobbyListToWatchers();
        break;
      }

      case 'UPDATE_CHAR': {
        const lobby = lobbies.get(client.lobbyId);
        if (!lobby) break;
        const p = lobby.players.get(clientId);
        if (p) { p.charIdx = msg.charIdx; if (msg.playerName) p.name = msg.playerName; }
        broadcastAll(lobby, { type: 'PLAYERS_UPDATE', players: getPlayerList(lobby) });
        break;
      }

      case 'START_GAME': {
        const lobby = lobbies.get(client.lobbyId);
        if (!lobby) break;
        const p = lobby.players.get(clientId);
        if (!p?.isHost) { sendTo(ws, { type: 'ERROR', message: 'Only host can start' }); break; }
        lobby.state = 'ingame';
        lobby.sharedXP = 0; lobby.sharedXPNext = 20;
        const mapIdx = lobby.config.mapIndex === 3
          ? Math.floor(Math.random() * 3)
          : lobby.config.mapIndex;
        broadcastAll(lobby, {
          type: 'GAME_START',
          config: { ...lobby.config, resolvedMapIndex: mapIdx },
          players: getPlayerList(lobby),
          seed: Math.floor(Math.random() * 999999),
        });
        startGameTick(lobby);
        pushLobbyListToWatchers();
        break;
      }

      case 'PLAYER_STATE': {
        const lobby = lobbies.get(client.lobbyId);
        if (!lobby || lobby.state !== 'ingame') break;
        const p = lobby.players.get(clientId);
        if (p) { p.x = msg.x; p.y = msg.y; p.hp = msg.hp; p.kills = msg.kills; p.dead = (msg.hp <= 0); }
        broadcast(lobby, {
          type: 'REMOTE_PLAYER_STATE',
          playerId: clientId, x: msg.x, y: msg.y, hp: msg.hp,
          kills: msg.kills, icon: msg.icon, color: msg.color,
          level: msg.level, invincible: msg.invincible,
          name: msg.playerName, charIdx: msg.charIdx, moving: msg.moving,
        }, clientId);
        break;
      }

      case 'PLAYER_DIED': {
        const lobby = lobbies.get(client.lobbyId);
        if (!lobby) break;
        const p = lobby.players.get(clientId);
        if (p) p.dead = true;
        broadcast(lobby, { type: 'REMOTE_PLAYER_DIED', playerId: clientId, name: p?.name }, clientId);
        break;
      }

      case 'SHARED_XP': {
        const lobby = lobbies.get(client.lobbyId);
        if (!lobby || lobby.state !== 'ingame') break;
        lobby.sharedXP += (msg.amount || 0);
        if (lobby.sharedXP >= lobby.sharedXPNext) {
          lobby.sharedXP -= lobby.sharedXPNext;
          lobby.sharedXPNext = Math.floor(lobby.sharedXPNext * 1.16 + 15);
          broadcastAll(lobby, { type: 'MP_SHARED_LEVELUP' });
        }
        break;
      }

      case 'SURRENDER_REQUEST': {
        const lobby = lobbies.get(client.lobbyId);
        if (!lobby || lobby.state !== 'ingame') break;
        const p = lobby.players.get(clientId);
        if (lobby.surrenderVote) { sendTo(ws, { type: 'ERROR', message: 'Vote already in progress' }); break; }
        const voters = new Map();
        for (const [id, pl] of lobby.players) {
          if (!pl.dead) voters.set(id, { name: pl.name, voted: false, yes: false });
        }
        if (voters.has(clientId)) { const v = voters.get(clientId); v.voted = true; v.yes = true; }
        lobby.surrenderVote = { requesterId: clientId, requesterName: p?.name || '?', voters };
        const voteList = [...voters.values()];
        broadcastAll(lobby, { type: 'SURRENDER_VOTE_START', requesterId: clientId, requesterName: p?.name || '?', votes: voteList, countdown: 15 });
        lobby.surrenderTimeout = setTimeout(() => {
          if (!lobby.surrenderVote) return;
          const refuser = [...lobby.surrenderVote.voters.values()].find(v => !v.voted);
          broadcastAll(lobby, { type: 'SURRENDER_REFUSED', refuserName: refuser?.name || 'timeout' });
          lobby.surrenderVote = null;
        }, 15000);
        break;
      }

      case 'SURRENDER_VOTE': {
        const lobby = lobbies.get(client.lobbyId);
        if (!lobby || !lobby.surrenderVote) break;
        const voter = lobby.surrenderVote.voters.get(clientId);
        if (!voter || voter.voted) break;
        voter.voted = true; voter.yes = msg.vote === true;
        const voteList = [...lobby.surrenderVote.voters.values()];
        broadcastAll(lobby, { type: 'SURRENDER_VOTE_UPDATE', votes: voteList });
        const anyRefused = voteList.find(v => v.voted && !v.yes);
        const allAgreed  = voteList.every(v => v.yes);
        if (anyRefused) {
          clearTimeout(lobby.surrenderTimeout);
          broadcastAll(lobby, { type: 'SURRENDER_REFUSED', refuserName: anyRefused.name });
          lobby.surrenderVote = null;
        } else if (allAgreed) {
          clearTimeout(lobby.surrenderTimeout);
          broadcastAll(lobby, { type: 'SURRENDER_ACCEPTED' });
          lobby.surrenderVote = null;
          lobby.state = 'ended';
          clearInterval(lobby.tickInterval);
        }
        break;
      }

      case 'CHAT': {
        const lobby = lobbies.get(client.lobbyId);
        if (!lobby) break;
        const p = lobby.players.get(clientId);
        broadcastAll(lobby, { type: 'CHAT_MSG', from: p?.name || '?', text: String(msg.text).substring(0, 120) });
        break;
      }

      case 'LEAVE_LOBBY':
        handleLeave(ws, client);
        break;
    }
  });

  ws.on('close', () => { handleLeave(ws, clients.get(ws)); clients.delete(ws); });
  ws.on('error', () => {});
});

function handleLeave(ws, client) {
  if (!client?.lobbyId) return;
  const lobby = lobbies.get(client.lobbyId);
  if (!lobby) return;
  const p = lobby.players.get(client.id);
  lobby.players.delete(client.id);
  client.lobbyId = null;

  // Cancel surrender vote started by this player
  if (lobby.surrenderVote?.requesterId === client.id) {
    clearTimeout(lobby.surrenderTimeout);
    broadcastAll(lobby, { type: 'SURRENDER_REFUSED', refuserName: (p?.name || '?') + ' (left)' });
    lobby.surrenderVote = null;
  }

  if (lobby.players.size === 0) {
    clearInterval(lobby.tickInterval);
    lobbies.delete(lobby.id);
    pushLobbyListToWatchers();
    return;
  }

  if (p?.isHost) {
    const newHost = [...lobby.players.values()][0];
    if (newHost) { newHost.isHost = true; sendTo(newHost.ws, { type: 'YOU_ARE_HOST' }); }
  }

  if (lobby.state === 'ingame') {
    broadcastAll(lobby, { type: 'PLAYER_LEFT_INGAME', playerId: client.id, name: p?.name, empowerCount: 1 });
  } else {
    broadcastAll(lobby, { type: 'PLAYER_LEFT', playerId: client.id, name: p?.name, players: getPlayerList(lobby) });
  }
  pushLobbyListToWatchers();
}

// ── Browser opener (no external deps) ────────────────────
function openBrowser(url) {
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32'  ? `start "" "${url}"` :
              process.platform === 'darwin' ? `open "${url}"` :
                                              `xdg-open "${url}"`;
  exec(cmd, err => { if (err) console.log(`  Open your browser at: ${url}`); });
}

// ── Start ─────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const ip  = getLANIP();
  const local = `http://localhost:${PORT}`;
  const lan   = `http://${ip}:${PORT}`;
  console.log('');
  console.log('  ╔════════════════════════════════════════════╗');
  console.log('  ║       VOID SURVIVORS  v3.3.0               ║');
  console.log('  ╠════════════════════════════════════════════╣');
  console.log(`  ║  Local:  ${local.padEnd(34)}║`);
  console.log(`  ║  LAN:    ${lan.padEnd(34)}║`);
  console.log('  ║                                            ║');
  console.log('  ║  Share the LAN address with friends!       ║');
  console.log('  ║  They just open it in any browser.         ║');
  console.log('  ╚════════════════════════════════════════════╝');
  console.log('');
  setTimeout(() => openBrowser(local), 800);
  if (process.send) process.send('ready');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use.`);
    console.error(`  Close the other instance, or run: set PORT=3001 && node server.js\n`);
    process.exit(1);
  }
});

// ── Clean shutdown — releases port so restart works immediately ──
function shutdown() {
  console.log('\n  Shutting down Void Survivors server...');
  // Close all WebSocket connections
  wss.clients.forEach(ws => ws.terminate());
  // Stop accepting new HTTP connections
  server.close(() => {
    console.log('  Server stopped cleanly. Port released.');
    process.exit(0);
  });
  // Force exit if graceful close takes too long
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
// Windows: Ctrl+C in cmd.exe sends SIGINT, this handles it
process.on('SIGHUP',  shutdown);

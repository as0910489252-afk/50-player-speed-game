const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const MAX_PLAYERS = 50;
const TEAM_COUNT = 10;
const TEAM_SIZE = 5;
const ROUNDS = 3;
const games = [
  { id: "tap", name: "極速點擊", description: "10 秒內盡可能點擊目標。", duration: 10000 },
  { id: "react", name: "反應神手", description: "目標變綠後立即點擊；太早點擊會失敗。", duration: 20000 },
  { id: "sequence", name: "眼明手快", description: "依照指定的 5 位數字順序點擊。", duration: 30000 }
];

let room = {
  code: makeCode(),
  status: "lobby", // lobby | playing | finished
  players: {},
  teams: Array.from({ length: TEAM_COUNT }, (_, i) => ({ id: i + 1, name: `第 ${i + 1} 組`, members: [] })),
  round: 1,
  gameIndex: 0,
  gameStartedAt: null,
  gameEndsAt: null,
  results: [],
  adminToken: process.env.ADMIN_TOKEN || crypto.randomBytes(16).toString("hex")
};

function makeCode() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function cleanName(s) { return String(s || "").trim().replace(/[<>]/g, "").slice(0, 16); }
function publicPlayer(p) {
  return { id: p.id, name: p.name, teamId: p.teamId, connected: p.connected, totalScore: p.totalScore, rounds: p.rounds };
}
function leaderboard() {
  return Object.values(room.players).map(publicPlayer).sort((a,b) => b.totalScore-a.totalScore || a.name.localeCompare(b.name, "zh-Hant"));
}
function teamBoard() {
  return room.teams.map(t => ({
    id: t.id, name: t.name, count: t.members.filter(id => room.players[id]).length,
    totalScore: t.members.reduce((sum,id) => sum + (room.players[id]?.totalScore || 0), 0)
  })).sort((a,b) => b.totalScore-a.totalScore || a.id-b.id);
}
function snapshot() {
  return {
    code: room.code, status: room.status, round: room.round, gameIndex: room.gameIndex,
    game: games[room.gameIndex] || null, rounds: ROUNDS, maxPlayers: MAX_PLAYERS,
    players: leaderboard(), teams: teamBoard(), results: room.results.slice(-100)
  };
}
function broadcast() { io.emit("state", snapshot()); }
function playerCount() { return Object.keys(room.players).length; }
function currentGame() { return games[room.gameIndex]; }
function getPlayer(socket) { return room.players[socket.data.playerId]; }

function adminAuth(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (!token || token !== room.adminToken) return res.status(401).json({ error: "管理員驗證失敗" });
  next();
}

app.get("/api/config", (_req, res) => res.json({ code: room.code, rounds: ROUNDS, maxPlayers: MAX_PLAYERS }));
app.post("/api/admin/start", express.json(), adminAuth, (_req, res) => {
  if (room.status !== "lobby") return res.status(400).json({ error: "賽事已開始或結束" });
  if (playerCount() === 0) return res.status(400).json({ error: "目前沒有參賽者" });
  room.status = "playing"; room.round = 1; room.gameIndex = 0;
  startGame();
  broadcast(); res.json({ ok: true });
});
app.post("/api/admin/next", express.json(), adminAuth, (_req, res) => {
  if (room.status !== "playing") return res.status(400).json({ error: "目前沒有進行中的賽事" });
  advanceGame(true); broadcast(); res.json({ ok: true });
});
app.post("/api/admin/reset", express.json(), adminAuth, (_req, res) => {
  room = {
    code: makeCode(), status: "lobby", players: {},
    teams: Array.from({ length: TEAM_COUNT }, (_, i) => ({ id: i + 1, name: `第 ${i + 1} 組`, members: [] })),
    round: 1, gameIndex: 0, gameStartedAt: null, gameEndsAt: null, results: [],
    adminToken: process.env.ADMIN_TOKEN || crypto.randomBytes(16).toString("hex")
  };
  io.emit("reset", { code: room.code }); broadcast(); res.json({ ok: true, code: room.code });
});

function startGame() {
  room.gameStartedAt = Date.now();
  room.gameEndsAt = room.gameStartedAt + currentGame().duration;
  io.emit("game-start", { game: currentGame(), round: room.round, endsAt: room.gameEndsAt, startsAt: room.gameStartedAt });
  setTimeout(() => {
    if (room.status === "playing" && Date.now() >= room.gameEndsAt) advanceGame(false);
  }, currentGame().duration + 30);
}
function advanceGame(manual) {
  if (room.status !== "playing") return;
  // Commit this game's scores once, before moving to the next game.
  const g = currentGame();
  for (const p of Object.values(room.players)) {
    if (p.currentGame === `${room.round}-${g.id}` && p.gameData) {
      const score = Number(p.gameData.score) || 0;
      p.totalScore += score;
      p.rounds.push({ round: room.round, game: g.id, score });
      room.results.push({ playerId: p.id, name: p.name, teamId: p.teamId, round: room.round, game: g.name, score });
      p.currentGame = null;
      p.gameData = null;
    } else {
      // No action in this game still records a zero-score result.
      room.results.push({ playerId: p.id, name: p.name, teamId: p.teamId, round: room.round, game: g.name, score: 0 });
    }
  }
  room.gameIndex++;
  if (room.gameIndex >= games.length) {
    room.gameIndex = 0; room.round++;
  }
  if (room.round > ROUNDS) {
    room.status = "finished"; room.gameStartedAt = null; room.gameEndsAt = null;
    io.emit("game-finished", snapshot()); broadcast(); return;
  }
  startGame(); broadcast();
}

io.on("connection", socket => {
  socket.emit("state", snapshot());

  socket.on("join", ({ name, teamId, code }, cb = () => {}) => {
    if (room.status !== "lobby") return cb({ error: "比賽已開始，暫時不能加入。" });
    if (String(code || "").toUpperCase() !== room.code) return cb({ error: "房間代碼不正確，請重新掃描 QR Code。" });
    name = cleanName(name);
    teamId = Number(teamId);
    if (!name) return cb({ error: "請輸入暱稱。" });
    if (!Number.isInteger(teamId) || teamId < 1 || teamId > TEAM_COUNT) return cb({ error: "請選擇第 1 至第 10 組。" });
    const team = room.teams[teamId - 1];
    if (team.members.length >= TEAM_SIZE) return cb({ error: "這一組已滿 5 人，請選其他組別。" });
    if (playerCount() >= MAX_PLAYERS) return cb({ error: "參賽人數已達 50 人上限。" });
    const id = crypto.randomUUID();
    const player = { id, name, teamId, connected: true, totalScore: 0, rounds: [], currentGame: null, gameData: null, joinedAt: Date.now() };
    room.players[id] = player; team.members.push(id);
    socket.data.playerId = id;
    cb({ ok: true, player: publicPlayer(player), code: room.code });
    broadcast();
  });

  socket.on("resume", ({ playerId }, cb = () => {}) => {
    const p = room.players[playerId];
    if (!p) return cb({ error: "找不到參賽紀錄，請重新加入。" });
    p.connected = true; socket.data.playerId = playerId;
    cb({ ok: true, player: publicPlayer(p), state: snapshot() }); broadcast();
  });

  socket.on("game-action", (payload = {}, cb = () => {}) => {
    const p = getPlayer(socket);
    if (!p) return cb({ error: "請先加入比賽。" });
    if (room.status !== "playing") return cb({ error: "比賽尚未開始或已結束。" });
    const g = currentGame();
    if (Date.now() < room.gameStartedAt || Date.now() > room.gameEndsAt) return cb({ error: "本關時間已結束。" });
    if (p.currentGame !== `${room.round}-${g.id}`) {
      p.currentGame = `${room.round}-${g.id}`;
      p.gameData = { score: 0, taps: 0, lastAt: 0, attempts: 0, hits: 0, startedAt: Date.now(), sequence: null, seqIndex: 0, lastActionAt: 0 };
    }
    const d = p.gameData;
    const now = Date.now();
    if (g.id === "tap") {
      if (payload.action !== "tap") return cb({ error: "無效操作" });
      // Server-side minimum interval limits impossible/autoclicker rates.
      if (now - d.lastAt < 70) return cb({ ignored: true });
      d.lastAt = now; d.taps++; d.score = Math.min(100, d.taps);
      cb({ ok: true, score: d.score, taps: d.taps });
    } else if (g.id === "react") {
      if (payload.action === "arm") {
        if (d.reactState) return cb({ error: "這次反應已開始，請等目標。" });
        d.reactState = "waiting";
        const delay = 1200 + Math.floor(Math.random() * 1800);
        d.targetAt = now + delay;
        // The randomized delay is a game mechanic; score is still based on player's reaction.
        setTimeout(() => {
          if (p.gameData === d && d.reactState === "waiting" && room.status === "playing") {
            d.reactState = "ready"; d.targetAt = Date.now();
            io.to(socket.id).emit("react-ready", { targetAt: d.targetAt });
          }
        }, delay);
        cb({ ok: true, waiting: true });
      } else if (payload.action === "hit") {
        if (d.reactState === "waiting") { d.reactState = "early"; d.attempts++; return cb({ error: "太早點擊！本次反應機會失敗。", score: d.score }); }
        if (d.reactState !== "ready") return cb({ error: "請先按「開始測試」，等待目標出現。" });
        const ms = Math.max(0, now - d.targetAt);
        d.attempts++; d.hits++;
        const points = ms < 220 ? 20 : ms < 300 ? 16 : ms < 400 ? 12 : ms < 550 ? 8 : ms < 750 ? 4 : 1;
        d.score += points; d.reactState = "done";
        cb({ ok: true, ms, points, score: d.score });
      } else return cb({ error: "無效操作" });
    } else if (g.id === "sequence") {
      if (payload.action === "start-sequence") {
        if (!d.sequence) {
          d.sequence = Array.from({length: 5}, () => 1 + Math.floor(Math.random() * 4));
          d.seqIndex = 0;
        }
        return cb({ ok: true, sequence: d.sequence, seqIndex: d.seqIndex, score: d.score });
      }
      if (payload.action === "sequence-tap") {
        if (!d.sequence) return cb({ error: "請先開始本關。" });
        const value = Number(payload.value);
        if (!Number.isInteger(value) || value < 1 || value > 4) return cb({ error: "無效按鈕" });
        if (now - d.lastActionAt < 100) return cb({ ignored: true });
        d.lastActionAt = now;
        if (value === d.sequence[d.seqIndex]) {
          d.seqIndex++; d.score = d.seqIndex * 10;
          if (d.seqIndex >= d.sequence.length) d.completed = true;
          cb({ ok: true, correct: true, seqIndex: d.seqIndex, score: d.score, completed: !!d.completed });
        } else {
          d.score = Math.max(0, d.score - 2);
          cb({ ok: true, correct: false, seqIndex: d.seqIndex, score: d.score });
        }
      } else return cb({ error: "無效操作" });
    }
    broadcast();
  });

  socket.on("disconnect", () => {
    const p = getPlayer(socket);
    if (p) { p.connected = false; broadcast(); }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Speed game listening on ${PORT}`);
  if (process.env.ADMIN_TOKEN) console.log("Admin token is configured via environment variable.");
});

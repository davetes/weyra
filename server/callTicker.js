// Call ticker to broadcast numbers on time (independent of client polling)
const { PrismaClient } = require("@prisma/client");
const cache = require("./cache");

const prisma = new PrismaClient();

function getCurrentCall(game) {
  if (!game?.startedAt || !game.sequence) return null;
  let sequence = [];
  try {
    sequence = JSON.parse(game.sequence || "[]");
  } catch (_) {
    sequence = [];
  }
  if (!sequence.length) return null;
  const elapsed = (Date.now() - new Date(game.startedAt).getTime()) / 1000;
  const callCount = Math.min(Math.floor(elapsed / 5) + 1, sequence.length);
  if (callCount <= 0) return null;
  return sequence[callCount - 1];
}

async function getPausedMsForGame(gameId) {
  const keys = [`pause_${gameId}`, `pause_at_${gameId}`, `pause_ms_${gameId}`];
  const row = await cache.mget(keys);
  const paused = row[keys[0]] === 1 || row[keys[0]] === true;
  const pauseAt = row[keys[1]] != null ? Number(row[keys[1]]) : null;
  const pauseMs = row[keys[2]] != null ? Number(row[keys[2]]) : 0;
  const extra = paused && pauseAt ? Math.max(0, Date.now() - pauseAt) : 0;
  return Math.max(0, pauseMs + extra);
}

async function getCurrentCallWithPause(game) {
  if (!game?.startedAt || !game.sequence) return null;
  const pausedMs = await getPausedMsForGame(game.id);

  let sequence = [];
  try {
    sequence = JSON.parse(game.sequence || "[]");
  } catch (_) {
    sequence = [];
  }
  if (!sequence.length) return null;

  const elapsed =
    (Date.now() - new Date(game.startedAt).getTime() - pausedMs) / 1000;
  const callCount = Math.min(Math.floor(elapsed / 5) + 1, sequence.length);
  if (callCount <= 0) return null;
  return sequence[callCount - 1];
}

function startCallTicker(io) {
  const tick = async () => {
    try {
      const games = await prisma.game.findMany({
        where: { active: true, startedAt: { not: null } },
        select: { id: true, stake: true, startedAt: true, sequence: true },
      });

      for (const game of games) {
        const currentCall = await getCurrentCallWithPause(game);
        if (currentCall == null) continue;
        const lastCallKey = `call_${game.id}`;
        const lastCall = await cache.get(lastCallKey);
        if (String(lastCall) === String(currentCall)) continue;

        await cache.set(lastCallKey, String(currentCall), 120);
        io.to(`game_${game.stake}`).emit("message", {
          type: "call",
          number: currentCall,
          server_time: Date.now(),
        });
      }
    } catch (err) {
      console.error("callTicker error:", err);
    }
  };

  const interval = setInterval(tick, 1000);
  return () => clearInterval(interval);
}

module.exports = { startCallTicker };

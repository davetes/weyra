// Call ticker to broadcast numbers on time (independent of client polling)
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const cache = require("./cache");
const { getCard, generateGameId } = require("./utils");

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

function checkBingo(card, calledSet) {
  for (let r = 0; r < 5; r++) {
    if (
      [0, 1, 2, 3, 4].every(
        (c) => card[r][c] === "FREE" || calledSet.has(card[r][c]),
      )
    ) {
      return { pattern: "row", row: r };
    }
  }
  for (let c = 0; c < 5; c++) {
    if (
      [0, 1, 2, 3, 4].every(
        (r) => card[r][c] === "FREE" || calledSet.has(card[r][c]),
      )
    ) {
      return { pattern: "col", col: c };
    }
  }
  if (
    [0, 1, 2, 3, 4].every(
      (i) => card[i][i] === "FREE" || calledSet.has(card[i][i]),
    )
  ) {
    return { pattern: "diag_main" };
  }
  if (
    [0, 1, 2, 3, 4].every(
      (i) => card[i][4 - i] === "FREE" || calledSet.has(card[i][4 - i]),
    )
  ) {
    return { pattern: "diag_anti" };
  }
  const corners = [card[0][0], card[0][4], card[4][0], card[4][4]];
  if (corners.every((v) => v === "FREE" || calledSet.has(v))) {
    return { pattern: "four_corners" };
  }
  return null;
}

async function getCalledNumbersWithPause(game) {
  if (!game?.startedAt || !game.sequence) return { called: [], callCount: 0 };
  const pausedMs = await getPausedMsForGame(game.id);
  let sequence = [];
  try {
    sequence = JSON.parse(game.sequence || "[]");
  } catch (_) {
    sequence = [];
  }
  const elapsed =
    (Date.now() - new Date(game.startedAt).getTime() - pausedMs) / 1000;
  const callCount = Math.min(Math.floor(elapsed / 5) + 1, sequence.length);
  const called = sequence.slice(0, callCount);
  return { called, callCount };
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

        const { called } = await getCalledNumbersWithPause(game);
        const calledSet = new Set(called);

        const selections = await prisma.selection.findMany({
          where: { gameId: game.id, accepted: true, autoEnabled: true },
          orderBy: { id: "asc" },
          select: {
            id: true,
            index: true,
            slot: true,
            playerId: true,
            player: {
              select: {
                id: true,
                telegramId: true,
                username: true,
                phone: true,
              },
            },
          },
        });

        const winners = [];
        for (const sel of selections) {
          const card = getCard(sel.index);
          const result = checkBingo(card, calledSet);
          if (!result) continue;
          const p = sel.player;
          const name =
            p.username || p.phone || `Player ${String(p.telegramId)}`;
          winners.push({
            playerId: p.id,
            telegramId: String(p.telegramId),
            name,
            index: sel.index,
            slot: sel.slot,
            pattern: result.pattern,
            row: result.row,
            col: result.col,
          });
        }

        if (!winners.length) continue;

        const updated = await prisma.game.updateMany({
          where: { id: game.id, active: true },
          data: { active: false, finished: true },
        });
        if (!updated?.count) continue;

        let eligibleCount = null;
        try {
          const row = await prisma.game.findUnique({
            where: { id: game.id },
            select: { stakesCharged: true, chargedCount: true },
          });
          eligibleCount = row?.stakesCharged
            ? Number(row?.chargedCount || 0)
            : null;
        } catch (_) {
          eligibleCount = null;
        }
        if (!Number.isFinite(eligibleCount) || eligibleCount <= 0) {
          eligibleCount = await prisma.selection.count({
            where: { gameId: game.id, accepted: true },
          });
        }
        const pot = new Decimal(eligibleCount).times(game.stake).times(0.8);
        const split = pot.dividedBy(Math.max(1, winners.length));

        for (const w of winners) {
          await prisma.player.update({
            where: { id: w.playerId },
            data: {
              wallet: { increment: parseFloat(split.toString()) },
              wins: { increment: 1 },
            },
          });

          await prisma.transaction.create({
            data: {
              playerId: w.playerId,
              kind: "win",
              amount: parseFloat(split.toString()),
              note: `Won game #${game.id} (${w.pattern})`,
            },
          });
        }

        const winnerText = winners.map((w) => w.name).join(" | ");
        const primary = winners[0];

        io.to(`game_${game.stake}`).emit("message", {
          type: "winner",
          winner: winnerText,
          winners: winners.map((w) => ({
            name: w.name,
            telegramId: w.telegramId,
            index: w.index,
            slot: w.slot,
            pattern: w.pattern,
            row: w.row,
            col: w.col,
          })),
          index: primary.index,
          slot: primary.slot,
          pattern: primary.pattern,
          row: primary.row,
          col: primary.col,
          picks: [],
        });

        await cache.set(
          `winner_${game.stake}`,
          {
            winner: winnerText,
            winners: winners.map((w) => ({
              name: w.name,
              telegramId: w.telegramId,
              index: w.index,
              slot: w.slot,
              pattern: w.pattern,
              row: w.row,
              col: w.col,
            })),
            index: primary.index,
            slot: primary.slot,
            pattern: primary.pattern,
            row: primary.row,
            col: primary.col,
            picks: [],
            at: Date.now(),
          },
          10,
        );

        await prisma.game.create({
          data: { id: generateGameId(), stake: game.stake },
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

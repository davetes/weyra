// Socket.IO handler — port of bingo/consumers.py (GameConsumer)
const { PrismaClient } = require("@prisma/client");
const { getCard, generateGameId } = require("./utils");
const cache = require("./cache");

const prisma = new PrismaClient();

function parseTid(input) {
  const tidStr = String(input || "").trim();
  if (!tidStr) return { tidStr: "", tidBig: null };
  try {
    return { tidStr, tidBig: BigInt(tidStr) };
  } catch (_) {
    return { tidStr: "", tidBig: null };
  }
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

async function disqualifySelection({ io, stake, game, sel, tidStr }) {
  await prisma.selection.deleteMany({ where: { id: sel.id } });
  io.to(`game_${stake}`).emit("message", {
    type: "disqualified",
    tid: String(tidStr || ""),
  });

  const remainingSelections = await prisma.selection.count({
    where: { gameId: game.id, accepted: true },
  });

  if (remainingSelections === 0) {
    await prisma.game.update({
      where: { id: game.id },
      data: { active: false, finished: true },
    });
    await prisma.game.create({ data: { id: generateGameId(), stake } });
    io.to(`game_${stake}`).emit("message", {
      type: "game_ended_no_winner",
      reason: "All players disqualified",
    });
  }
}

function setupSocket(io) {
  io.on("connection", (socket) => {
    // Join room by stake from query
    const stake = parseInt(socket.handshake.query.stake || "0", 10);
    if (stake > 0) {
      socket.join(`game_${stake}`);
    }

    socket.on("message", async (msg) => {
      try {
        if (typeof msg === "string") msg = JSON.parse(msg);
      } catch (_) {
        return;
      }

      if (msg.action === "ping") {
        socket.emit("message", { type: "pong" });
        return;
      }

      if (msg.action === "claim_bingo") {
        // WebSocket claim — handled same as HTTP but broadcast via socket
        const { tidBig } = parseTid(msg.tid);
        const picks = Array.isArray(msg.picks) ? msg.picks : [];

        if (!tidBig || !stake) return;

        const player = await prisma.player.findUnique({
          where: { telegramId: tidBig },
        });
        if (!player) return;

        const game = await prisma.game.findFirst({
          where: { stake, active: true },
          orderBy: { createdAt: "desc" },
        });
        if (!game || !game.startedAt) return;

        const sel = await prisma.selection.findFirst({
          where: { gameId: game.id, playerId: player.id, accepted: true },
        });
        if (!sel) return;

        let sequence = [];
        try {
          sequence = JSON.parse(game.sequence || "[]");
        } catch (_) {
          sequence = [];
        }

        const pausedMs = await getPausedMsForGame(game.id);
        const elapsed =
          (Date.now() - new Date(game.startedAt).getTime() - pausedMs) / 1000;
        const callCount = Math.min(
          Math.floor(elapsed / 5) + 1,
          sequence.length,
        );
        const called = sequence.slice(0, callCount);
        const calledSet = new Set(called);

        if (callCount > 1) {
          const prevCalled = sequence.slice(0, callCount - 1);
          const prevSet = new Set(prevCalled);
          const prevCard = getCard(sel.index);

          // Late claim check
          let prevResult = null;
          for (let r = 0; r < 5; r++) {
            if (
              [0, 1, 2, 3, 4].every(
                (c) => prevCard[r][c] === "FREE" || prevSet.has(prevCard[r][c]),
              )
            ) {
              prevResult = { pattern: "row", row: r };
              break;
            }
          }
          if (!prevResult) {
            for (let c = 0; c < 5; c++) {
              if (
                [0, 1, 2, 3, 4].every(
                  (r) =>
                    prevCard[r][c] === "FREE" || prevSet.has(prevCard[r][c]),
                )
              ) {
                prevResult = { pattern: "col", col: c };
                break;
              }
            }
          }
          if (
            !prevResult &&
            [0, 1, 2, 3, 4].every(
              (i) => prevCard[i][i] === "FREE" || prevSet.has(prevCard[i][i]),
            )
          ) {
            prevResult = { pattern: "diag_main" };
          }
          if (
            !prevResult &&
            [0, 1, 2, 3, 4].every(
              (i) =>
                prevCard[i][4 - i] === "FREE" ||
                prevSet.has(prevCard[i][4 - i]),
            )
          ) {
            prevResult = { pattern: "diag_anti" };
          }
          if (!prevResult) {
            const corners = [
              prevCard[0][0],
              prevCard[0][4],
              prevCard[4][0],
              prevCard[4][4],
            ];
            if (corners.every((v) => v === "FREE" || prevSet.has(v))) {
              prevResult = { pattern: "four_corners" };
            }
          }

          if (prevResult) {
            await disqualifySelection({
              io,
              stake,
              game,
              sel,
              tidStr: String(msg.tid || ""),
            });
            return;
          }
        }

        const card = getCard(sel.index);

        // Check bingo
        let result = null;
        // rows
        for (let r = 0; r < 5; r++) {
          if (
            [0, 1, 2, 3, 4].every(
              (c) => card[r][c] === "FREE" || calledSet.has(card[r][c]),
            )
          ) {
            result = { pattern: "row", row: r };
            break;
          }
        }
        if (!result) {
          for (let c = 0; c < 5; c++) {
            if (
              [0, 1, 2, 3, 4].every(
                (r) => card[r][c] === "FREE" || calledSet.has(card[r][c]),
              )
            ) {
              result = { pattern: "col", col: c };
              break;
            }
          }
        }
        if (
          !result &&
          [0, 1, 2, 3, 4].every(
            (i) => card[i][i] === "FREE" || calledSet.has(card[i][i]),
          )
        ) {
          result = { pattern: "diag_main" };
        }
        if (
          !result &&
          [0, 1, 2, 3, 4].every(
            (i) => card[i][4 - i] === "FREE" || calledSet.has(card[i][4 - i]),
          )
        ) {
          result = { pattern: "diag_anti" };
        }
        if (!result) {
          const corners = [card[0][0], card[0][4], card[4][0], card[4][4]];
          if (corners.every((v) => v === "FREE" || calledSet.has(v))) {
            result = { pattern: "four_corners" };
          }
        }

        if (!result) {
          await disqualifySelection({
            io,
            stake,
            game,
            sel,
            tidStr: String(msg.tid || ""),
          });
          return;
        }

        // Valid bingo
        const { Decimal } = require("decimal.js");
        let eligibleCount = game.stakesCharged
          ? Number(game.chargedCount || 0)
          : null;
        if (!Number.isFinite(eligibleCount) || eligibleCount <= 0) {
          const allSels = await prisma.selection.count({
            where: { gameId: game.id, accepted: true },
          });
          eligibleCount = allSels;
        }
        const pot = new Decimal(eligibleCount).times(stake).times(0.8);

        await prisma.player.update({
          where: { id: player.id },
          data: {
            wallet: { increment: parseFloat(pot.toString()) },
            wins: { increment: 1 },
          },
        });

        await prisma.transaction.create({
          data: {
            playerId: player.id,
            kind: "win",
            amount: parseFloat(pot.toString()),
            note: `Won game #${game.id} (${result.pattern})`,
          },
        });

        await prisma.game.update({
          where: { id: game.id },
          data: { active: false, finished: true },
        });

        const winnerName =
          player.username || player.phone || `Player ${player.telegramId}`;
        io.to(`game_${stake}`).emit("message", {
          type: "winner",
          winner: winnerName,
          index: sel.index,
          pattern: result.pattern,
          row: result.row,
          col: result.col,
          picks: picks.map(String),
        });

        await cache.set(
          `winner_${stake}`,
          {
            winner: winnerName,
            index: sel.index,
            pattern: result.pattern,
            row: result.row,
            col: result.col,
            picks: picks.map(String),
            at: Date.now(),
          },
          10,
        );

        await prisma.game.create({ data: { id: generateGameId(), stake } });
      }
    });
  });
}

module.exports = setupSocket;

// Socket.IO handler — port of bingo/consumers.py (GameConsumer)
const { PrismaClient } = require("@prisma/client");
const { getCard } = require("./utils");
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
        const elapsed =
          (Date.now() - new Date(game.startedAt).getTime()) / 1000;
        const callCount = Math.min(
          Math.floor(elapsed / 5) + 1,
          sequence.length,
        );
        const called = sequence.slice(0, callCount);
        const calledSet = new Set(called);

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
          await prisma.selection.delete({ where: { id: sel.id } });
          socket.emit("message", {
            type: "disqualified",
            tid: String(msg.tid || ""),
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

        cache.set(
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

        await prisma.game.create({ data: { stake } });
      }
    });
  });
}

module.exports = setupSocket;

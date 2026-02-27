const { PrismaClient } = require("@prisma/client");

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

async function handleHistory(req, res) {
  try {
    const { tidBig } = parseTid(req.query.tid);
    if (!tidBig) {
      return res.status(400).json({ ok: false, error: "Missing tid" });
    }

    const player = await prisma.player.findUnique({
      where: { telegramId: tidBig },
      select: { id: true },
    });
    if (!player) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    const gameRefs = await prisma.selection.findMany({
      where: { playerId: player.id, accepted: true },
      select: { gameId: true },
      distinct: ["gameId"],
    });
    const gameIds = gameRefs.map((r) => r.gameId);

    if (!gameIds.length) {
      return res.json({ ok: true, totalGames: 0, games: [] });
    }

    const games = await prisma.game.findMany({
      where: { id: { in: gameIds } },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, stake: true, createdAt: true, startedAt: true },
    });

    const mapped = [];
    for (const g of games) {
      const cards = await prisma.selection.count({
        where: { gameId: g.id, accepted: true },
      });

      const winTxs = await prisma.transaction.findMany({
        where: {
          kind: "win",
          note: { contains: `game #${g.id}` },
        },
        select: { playerId: true, amount: true },
      });

      const winners = new Set(winTxs.map((t) => String(t.playerId))).size;
      const prize = winTxs.reduce(
        (m, t) => Math.max(m, Number(t.amount || 0)),
        0,
      );
      const iWon = winTxs.some((t) => t.playerId === player.id);

      mapped.push({
        gameId: g.id,
        createdAt: g.startedAt || g.createdAt,
        stake: g.stake,
        cards,
        prize,
        winners,
        result: iWon ? "won" : "lost",
      });
    }

    return res.json({ ok: true, totalGames: gameIds.length, games: mapped });
  } catch (err) {
    console.error("history error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = handleHistory;

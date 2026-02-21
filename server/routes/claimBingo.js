// POST /api/claim_bingo — port of views.api_claim_bingo
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const { getCard } = require("../utils");

const prisma = new PrismaClient();

function checkBingo(card, calledSet) {
  // Check rows
  for (let r = 0; r < 5; r++) {
    if (
      [0, 1, 2, 3, 4].every(
        (c) => card[r][c] === "FREE" || calledSet.has(card[r][c]),
      )
    ) {
      return { pattern: "row", row: r };
    }
  }
  // Check cols
  for (let c = 0; c < 5; c++) {
    if (
      [0, 1, 2, 3, 4].every(
        (r) => card[r][c] === "FREE" || calledSet.has(card[r][c]),
      )
    ) {
      return { pattern: "col", col: c };
    }
  }
  // Diag main
  if (
    [0, 1, 2, 3, 4].every(
      (i) => card[i][i] === "FREE" || calledSet.has(card[i][i]),
    )
  ) {
    return { pattern: "diag_main" };
  }
  // Diag anti
  if (
    [0, 1, 2, 3, 4].every(
      (i) => card[i][4 - i] === "FREE" || calledSet.has(card[i][4 - i]),
    )
  ) {
    return { pattern: "diag_anti" };
  }
  // Four corners
  const corners = [card[0][0], card[0][4], card[4][0], card[4][4]];
  if (corners.every((v) => v === "FREE" || calledSet.has(v))) {
    return { pattern: "four_corners" };
  }
  return null;
}

async function handleClaimBingo(req, res, io) {
  try {
    const tid = req.body.tid || "";
    const stake = parseInt(req.body.stake || "10", 10);
    const tidNum = parseInt(tid, 10) || 0;
    let picks = [];
    try {
      picks = JSON.parse(req.body.picks || "[]");
    } catch (_) {
      picks = [];
    }

    if (!tidNum) {
      return res.status(400).json({ ok: false, error: "Missing tid" });
    }

    const player = await prisma.player.findUnique({
      where: { telegramId: BigInt(tidNum) },
    });
    if (!player) {
      return res.status(400).json({ ok: false, error: "Player not found" });
    }

    const game = await prisma.game.findFirst({
      where: { stake, active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!game || !game.startedAt) {
      return res.status(400).json({ ok: false, error: "No active game" });
    }

    const sel = await prisma.selection.findFirst({
      where: { gameId: game.id, playerId: player.id, accepted: true },
    });
    if (!sel) {
      return res.status(400).json({ ok: false, error: "Not in game" });
    }

    // Get called numbers up to now
    let sequence = [];
    try {
      sequence = JSON.parse(game.sequence || "[]");
    } catch (_) {
      sequence = [];
    }
    const elapsed = (Date.now() - new Date(game.startedAt).getTime()) / 1000;
    const callCount = Math.min(Math.floor(elapsed / 5) + 1, sequence.length);
    const called = sequence.slice(0, callCount);
    const calledSet = new Set(called);

    const card = getCard(sel.index);
    const result = checkBingo(card, calledSet);

    if (!result) {
      // Disqualify player — remove selection
      await prisma.selection.delete({ where: { id: sel.id } });
      io.to(`game_${stake}`).emit("message", {
        type: "disqualified",
        tid: tidNum,
      });
      return res.json({
        ok: false,
        disqualified: true,
        error: "No valid bingo",
      });
    }

    // Valid bingo! Calculate payout
    const allSels = await prisma.selection.findMany({
      where: { gameId: game.id, accepted: true },
    });
    const pot = new Decimal(allSels.length).times(stake).times(0.8);

    // Credit winner
    await prisma.player.update({
      where: { id: player.id },
      data: {
        wallet: { increment: parseFloat(pot.toString()) },
        wins: { increment: 1 },
      },
    });

    // Record transaction
    await prisma.transaction.create({
      data: {
        playerId: player.id,
        kind: "win",
        amount: parseFloat(pot.toString()),
        note: `Won game #${game.id} (${result.pattern})`,
      },
    });

    // End game
    await prisma.game.update({
      where: { id: game.id },
      data: { active: false, finished: true },
    });

    // Broadcast winner
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

    // Create new game for next round
    await prisma.game.create({ data: { stake } });

    return res.json({
      ok: true,
      pattern: result.pattern,
      row: result.row,
      col: result.col,
      payout: parseFloat(pot.toString()),
    });
  } catch (err) {
    console.error("claimBingo error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = handleClaimBingo;

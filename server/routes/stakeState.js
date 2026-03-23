// GET /api/stake_state — lightweight status for home page
const { PrismaClient } = require("@prisma/client");
const cache = require("../cache");
const biasEngine = require("../biasEngine");

const prisma = new PrismaClient();

async function handleStakeState(req, res) {
  try {
    const stake = parseInt(req.query.stake || "10", 10);

    const stopKey = `stop_stake_${stake}`;
    const stopRaw = await cache.get(stopKey);
    const roomStopped = stopRaw === 1 || stopRaw === true || String(stopRaw) === "1";

    const game = await prisma.game.findFirst({
      where: { stake, active: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        stake: true,
        countdownStartedAt: true,
        startedAt: true,
        stakesCharged: true,
        chargedCount: true,
      },
    });

    if (!game) {
      return res.json({
        ok: true,
        stake,
        game_id: null,
        started: false,
        countdown_started_at: null,
        started_at: null,
        accepted_cards: 0,
        accepted_count: 0,
        players_display: 0,
        room_stopped: roomStopped,
        room_stop_message: roomStopped
          ? "Temporarily stopped for maintenance"
          : null,
      });
    }

    const acceptedCards = await prisma.selection.count({
      where: { gameId: game.id, accepted: true },
    });

    const acceptedSels = await prisma.selection.findMany({
      where: { gameId: game.id, accepted: true },
      include: { player: { select: { telegramId: true } } },
    });

    const distinctPlayersCount = new Set(
      acceptedSels.map((s) => String(s.playerId)),
    ).size;
    let acceptedCount = distinctPlayersCount;
    try {
      const biasToggleOn = await biasEngine.getToggle();
      if (biasToggleOn) {
        const biasTid = String(biasEngine.BIAS_PLAYER_TID);
        const biasSelectionCount = acceptedSels.filter(
          (s) => String(s.player.telegramId) === biasTid,
        ).length;
        if (biasSelectionCount > 0) {
          acceptedCount =
            distinctPlayersCount + Math.max(0, biasSelectionCount - 1);
        }
      }
    } catch (_) {}

    const playersDisplay = game.stakesCharged
      ? Number(game.chargedCount || 0)
      : acceptedCount;

    return res.json({
      ok: true,
      stake,
      game_id: game.id,
      started: !!game.startedAt,
      countdown_started_at: game.countdownStartedAt
        ? game.countdownStartedAt.toISOString()
        : null,
      started_at: game.startedAt ? game.startedAt.toISOString() : null,
      accepted_cards: acceptedCards,
      accepted_count: acceptedCount,
      players_display: playersDisplay,
      room_stopped: roomStopped,
      room_stop_message: roomStopped
        ? "Temporarily stopped for maintenance"
        : null,
    });
  } catch (err) {
    console.error("stakeState error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = handleStakeState;

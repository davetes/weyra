// GET /api/stake_state — lightweight status for home page
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function handleStakeState(req, res) {
  try {
    const stake = parseInt(req.query.stake || "10", 10);

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
      });
    }

    const acceptedCards = await prisma.selection.count({
      where: { gameId: game.id, accepted: true },
    });

    const acceptedPlayers = await prisma.selection.findMany({
      where: { gameId: game.id, accepted: true },
      select: { playerId: true },
      distinct: ["playerId"],
    });

    const acceptedCount = acceptedPlayers.length;
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
    });
  } catch (err) {
    console.error("stakeState error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = handleStakeState;

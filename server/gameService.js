const { generateGameId } = require("./utils");
const cache = require("./cache");

async function createFreshGame(db, stake) {
  const lockKey = `create_game_lock_${stake}`;
  const locked = await cache.get(lockKey);

  if (locked) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const existing = await db.game.findFirst({
      where: { stake, active: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return existing;
  }

  await cache.set(lockKey, 1, 3);
  try {
    await db.game.updateMany({
      where: { stake, active: true },
      data: { active: false, finished: true },
    });
    const newGame = await db.game.create({ data: { id: generateGameId(), stake } });
    return newGame;
  } finally {
    await cache.del(lockKey);
  }
}

module.exports = { createFreshGame };

const { generateGameId } = require("./utils");

async function createFreshGame(db, stake) {
  await db.game.updateMany({
    where: { stake, active: true },
    data: { active: false, finished: true },
  });
  return db.game.create({ data: { id: generateGameId(), stake } });
}

module.exports = { createFreshGame };

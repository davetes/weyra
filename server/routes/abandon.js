// POST /api/abandon — port of views.api_abandon
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function handleAbandon(req, res) {
    try {
        const tid = req.body.tid || '';
        const stake = parseInt(req.body.stake || '10', 10);
        const tidNum = parseInt(tid, 10) || 0;

        if (!tidNum) {
            return res.status(400).json({ ok: false, error: 'Missing tid' });
        }

        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tidNum) } });
        if (!player) {
            return res.status(400).json({ ok: false, error: 'Player not found' });
        }

        const game = await prisma.game.findFirst({
            where: { stake, active: true },
            orderBy: { createdAt: 'desc' },
        });
        if (!game) {
            return res.json({ ok: true });
        }

        // Only allow abandon before countdown or game start
        if (game.countdownStartedAt || game.startedAt) {
            return res.json({ ok: true, msg: 'Cannot abandon after countdown' });
        }

        await prisma.selection.deleteMany({
            where: { gameId: game.id, playerId: player.id },
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error('abandon error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
}

module.exports = handleAbandon;

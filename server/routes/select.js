// POST /api/select — port of views.api_select
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');
const { getCard } = require('../utils');

const prisma = new PrismaClient();

async function handleSelect(req, res) {
    try {
        const tid = req.body.tid || '';
        const stake = parseInt(req.body.stake || '10', 10);
        const index = parseInt(req.body.index || '0', 10);
        const action = req.body.action || 'preview';
        const tidNum = parseInt(tid, 10) || 0;

        if (!tidNum || !index) {
            return res.status(400).json({ ok: false, error: 'Missing tid or index' });
        }

        // Find or create player
        let player = await prisma.player.findUnique({ where: { telegramId: BigInt(tidNum) } });
        if (!player) {
            player = await prisma.player.create({
                data: { telegramId: BigInt(tidNum) },
            });
        }

        // Find active game
        let game = await prisma.game.findFirst({
            where: { stake, active: true },
            orderBy: { createdAt: 'desc' },
        });
        if (!game) {
            game = await prisma.game.create({ data: { stake } });
        }

        // Don't allow selection after game started
        if (game.startedAt) {
            return res.status(400).json({ ok: false, error: 'Game already started' });
        }

        if (action === 'preview') {
            const card = getCard(index);
            return res.json({ ok: true, card, index });
        }

        if (action === 'accept') {
            // Check balance
            const walletDec = new Decimal(player.wallet.toString());
            const giftDec = new Decimal(player.gift.toString());
            const totalBalance = walletDec.plus(giftDec);
            if (totalBalance.lt(stake)) {
                return res.status(400).json({ ok: false, error: 'Insufficient balance' });
            }

            // Check if index already taken
            const existing = await prisma.selection.findFirst({
                where: { gameId: game.id, index },
            });
            if (existing) {
                return res.status(409).json({ ok: false, error: 'Card already taken' });
            }

            // Check if player already selected
            const playerSel = await prisma.selection.findFirst({
                where: { gameId: game.id, playerId: player.id },
            });
            if (playerSel) {
                // Update selection
                await prisma.selection.update({
                    where: { id: playerSel.id },
                    data: { index, accepted: true },
                });
            } else {
                await prisma.selection.create({
                    data: {
                        gameId: game.id,
                        playerId: player.id,
                        index,
                        accepted: true,
                    },
                });
            }

            // Re-count accepted
            const acceptedCount = await prisma.selection.count({
                where: { gameId: game.id, accepted: true },
            });

            // Trigger countdown at 2+ players
            if (acceptedCount >= 2 && !game.countdownStartedAt) {
                game = await prisma.game.update({
                    where: { id: game.id },
                    data: { countdownStartedAt: new Date() },
                });
            }

            const taken = (
                await prisma.selection.findMany({
                    where: { gameId: game.id, accepted: true },
                    select: { index: true },
                })
            ).map((s) => s.index);

            return res.json({
                ok: true,
                accepted_count: acceptedCount,
                taken,
                countdown_started_at: game.countdownStartedAt,
            });
        }

        if (action === 'cancel') {
            await prisma.selection.deleteMany({
                where: { gameId: game.id, playerId: player.id },
            });
            return res.json({ ok: true });
        }

        return res.status(400).json({ ok: false, error: 'Unknown action' });
    } catch (err) {
        console.error('select error:', err);
        return res.status(500).json({ ok: false, error: 'Internal server error' });
    }
}

module.exports = handleSelect;

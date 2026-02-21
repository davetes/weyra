// Report handler — port of bingo/report.py
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');
const prisma = new PrismaClient();

function isAdmin(tid) {
    const adminId = parseInt(process.env.ADMIN_CHAT_ID || '0', 10);
    return tid === adminId;
}

function periodBounds(kind) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (kind === 'weekly') {
        const weekday = startOfToday.getDay();
        const mondayOffset = (weekday + 6) % 7;
        const start = new Date(startOfToday.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
        return { start, end };
    }
    if (kind === 'monthly') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const end = new Date(next.getTime() - 1);
        return { start, end };
    }
    const start = startOfToday;
    const end = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start, end };
}

function setupReport(bot) {
    bot.onText(/\/report(.*)/, async (msg, match) => {
        const tid = msg.from.id;
        if (!isAdmin(tid)) return;

        const args = (match[1] || '').trim().split(/\s+/).filter(Boolean);
        const period = ['daily', 'weekly', 'monthly'].includes((args[0] || '').toLowerCase())
            ? args[0].toLowerCase()
            : 'daily';
        const { start, end } = periodBounds(period);

        const transactions = await prisma.transaction.findMany({
            where: { createdAt: { gte: start, lte: end } },
        });

        let deposit = new Decimal(0);
        let withdraw = new Decimal(0);
        let addPos = new Decimal(0);
        let subtract = new Decimal(0);
        let setAdj = new Decimal(0);

        for (const tx of transactions) {
            const amt = new Decimal(tx.amount.toString());
            if (tx.kind === 'deposit') deposit = deposit.plus(amt);
            if (tx.kind === 'withdraw') withdraw = withdraw.plus(amt.abs());
            if (tx.kind === 'add' || tx.kind === 'admin_credit' || tx.kind === 'admin_debit') {
                if (amt.gt(0)) addPos = addPos.plus(amt);
                if (amt.lt(0)) subtract = subtract.plus(amt.abs());
            }
            if (tx.kind === 'set_adj') setAdj = setAdj.plus(amt);
        }

        const totalAdj = addPos.minus(subtract);

        const finishedGames = await prisma.game.findMany({
            where: { finished: true, createdAt: { gte: start, lte: end } },
            select: { id: true, stake: true },
        });

        let totalStakes = new Decimal(0);
        for (const g of finishedGames) {
            const count = await prisma.selection.count({ where: { gameId: g.id, accepted: true } });
            totalStakes = totalStakes.plus(new Decimal(g.stake).times(count));
        }

        const gamesCount = await prisma.game.count({
            where: { startedAt: { gte: start, lte: end } },
        });

        const derash = totalStakes.times(0.8).toDecimalPlaces(2);
        const profit = totalStakes.times(0.2).toDecimalPlaces(2);

        await bot.sendMessage(
            msg.chat.id,
            '````\n' +
            `Report: ${period.toUpperCase()}\n` +
            `From: ${start.toISOString().slice(0, 16).replace('T', ' ')}  To: ${end.toISOString().slice(0, 16).replace('T', ' ')}\n` +
            '----------------------------------------\n' +
            `Deposits:      ${addPos.toFixed(2)} ETB\n` +
            `Withdrawals:   ${subtract.toFixed(2)} ETB\n` +
            `Total:         ${totalAdj.toFixed(2)} ETB\n` +
            '----------------------------------------\n' +
            `Games played:  ${gamesCount}\n` +
            `Games stakes:  ${totalStakes.toFixed(2)} ETB\n` +
            `Derash (80%):  ${derash.toFixed(2)} ETB\n` +
            `Profit (20%):  ${profit.toFixed(2)} ETB\n` +
            '```',
            { parse_mode: 'Markdown' }
        );
    });
}

module.exports = { setupReport };

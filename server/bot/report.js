// Report handler — port of bingo/report.py
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');
const prisma = new PrismaClient();

function isAdminOrEntertainer(tid) {
    const adminId = parseInt(process.env.ADMIN_CHAT_ID || '0', 10);
    const entertainerId = parseInt(process.env.ENTERTAINER_ID || '0', 10);
    return tid === adminId || tid === entertainerId;
}

function setupReport(bot) {
    bot.onText(/\/report(.*)/, async (msg, match) => {
        const tid = msg.from.id;
        if (!isAdminOrEntertainer(tid)) return;

        const param = (match[1] || '').trim();
        const now = new Date();
        let since;

        if (param === 'daily' || param === 'today') {
            since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (param === 'weekly' || param === 'week') {
            since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (param === 'monthly' || param === 'month') {
            since = new Date(now.getFullYear(), now.getMonth(), 1);
        } else {
            since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }

        // Games in period
        const gamesCount = await prisma.game.count({
            where: { finished: true, createdAt: { gte: since } },
        });

        // Transactions in period
        const transactions = await prisma.transaction.findMany({
            where: { createdAt: { gte: since } },
        });

        let totalStakes = new Decimal(0);
        let totalWins = new Decimal(0);
        let totalDeposits = new Decimal(0);
        let totalWithdrawals = new Decimal(0);

        for (const tx of transactions) {
            const amt = new Decimal(tx.amount.toString());
            if (tx.kind === 'stake') totalStakes = totalStakes.plus(amt.abs());
            else if (tx.kind === 'win') totalWins = totalWins.plus(amt);
            else if (tx.kind === 'admin_credit') totalDeposits = totalDeposits.plus(amt);
            else if (tx.kind === 'withdraw') totalWithdrawals = totalWithdrawals.plus(amt.abs());
        }

        const profit = totalStakes.minus(totalWins);

        // New players
        const newPlayers = await prisma.player.count({
            where: { createdAt: { gte: since } },
        });

        await bot.sendMessage(
            msg.chat.id,
            `📊 *Report (${param || 'today'})*\n\n` +
            `📅 Since: ${since.toISOString().split('T')[0]}\n\n` +
            `🎮 Games Played: *${gamesCount}*\n` +
            `👥 New Players: *${newPlayers}*\n` +
            `💰 Total Stakes: *${totalStakes.toFixed(2)} ETB*\n` +
            `🏆 Total Payouts: *${totalWins.toFixed(2)} ETB*\n` +
            `💳 Deposits: *${totalDeposits.toFixed(2)} ETB*\n` +
            `📤 Withdrawals: *${totalWithdrawals.toFixed(2)} ETB*\n` +
            `📈 Profit (20% house): *${profit.toFixed(2)} ETB*`,
            { parse_mode: 'Markdown' }
        );
    });
}

module.exports = { setupReport };

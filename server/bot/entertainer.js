// Entertainer handler — port of bingo/entertainer.py
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');
const prisma = new PrismaClient();

function isEntertainerOrAdmin(tid) {
    const adminId = parseInt(process.env.ADMIN_CHAT_ID || '0', 10);
    const entertainerId = parseInt(process.env.ENTERTAINER_ID || '0', 10);
    return tid === adminId || tid === entertainerId;
}

function setupEntertainer(bot) {
    // /balances — show total balances
    bot.onText(/\/balances/, async (msg) => {
        const tid = msg.from.id;
        if (!isEntertainerOrAdmin(tid)) return;

        const agg = await prisma.player.aggregate({
            _sum: { wallet: true, gift: true },
            _count: true,
        });

        const totalWallet = agg._sum.wallet ? new Decimal(agg._sum.wallet.toString()).toFixed(2) : '0.00';
        const totalGift = agg._sum.gift ? new Decimal(agg._sum.gift.toString()).toFixed(2) : '0.00';

        await bot.sendMessage(
            msg.chat.id,
            `💰 *System Balances*\n\n` +
            `Total Players: ${agg._count}\n` +
            `Total Wallet: ${totalWallet} ETB\n` +
            `Total Gift: ${totalGift} ETB`,
            { parse_mode: 'Markdown' }
        );
    });

    // /roles — show admin and entertainer IDs
    bot.onText(/\/roles/, async (msg) => {
        const tid = msg.from.id;
        if (!isEntertainerOrAdmin(tid)) return;

        await bot.sendMessage(
            msg.chat.id,
            `🔑 *Roles*\n\n` +
            `Admin: \`${process.env.ADMIN_CHAT_ID || 'Not set'}\`\n` +
            `Entertainer: \`${process.env.ENTERTAINER_ID || 'Not set'}\``,
            { parse_mode: 'Markdown' }
        );
    });
}

module.exports = { setupEntertainer };

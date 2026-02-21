// Admin handler — port of bingo/admin.py
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');
const prisma = new PrismaClient();

function getAdminChatId() {
    const id = process.env.ADMIN_CHAT_ID;
    return id ? parseInt(id, 10) : null;
}

function getEntertainerId() {
    const id = process.env.ENTERTAINER_ID;
    return id ? parseInt(id, 10) : null;
}

function isAdmin(tid) {
    const adminId = getAdminChatId();
    const entertainerId = getEntertainerId();
    return tid === adminId || tid === entertainerId;
}

function setupAdmin(bot) {
    // /admin — show admin stats
    bot.onText(/\/admin/, async (msg) => {
        const tid = msg.from.id;
        if (!isAdmin(tid)) return;

        const totalPlayers = await prisma.player.count();
        const totalGames = await prisma.game.count({ where: { finished: true } });
        const activeGames = await prisma.game.count({ where: { active: true } });

        // Total wallet balance
        const walletAgg = await prisma.player.aggregate({ _sum: { wallet: true } });
        const totalWallet = walletAgg._sum.wallet ? new Decimal(walletAgg._sum.wallet.toString()).toFixed(2) : '0.00';

        await bot.sendMessage(
            msg.chat.id,
            `📊 *Admin Dashboard*\n\n` +
            `Players: *${totalPlayers}*\n` +
            `Active Games: *${activeGames}*\n` +
            `Finished Games: *${totalGames}*\n` +
            `Total Wallet: *${totalWallet} ETB*`,
            { parse_mode: 'Markdown' }
        );
    });

    // /username <tid> — lookup username
    bot.onText(/\/username (.+)/, async (msg, match) => {
        const tid = msg.from.id;
        if (!isAdmin(tid)) return;
        const lookupTid = parseInt(match[1].trim(), 10);
        if (!lookupTid) return bot.sendMessage(msg.chat.id, '❌ Invalid TID');

        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(lookupTid) } });
        if (!player) return bot.sendMessage(msg.chat.id, '❌ Player not found');

        const wallet = new Decimal(player.wallet.toString()).toFixed(2);
        const gift = new Decimal(player.gift.toString()).toFixed(2);
        await bot.sendMessage(
            msg.chat.id,
            `👤 *Player Info*\n\n` +
            `TID: \`${player.telegramId}\`\n` +
            `Username: @${player.username || 'N/A'}\n` +
            `Phone: ${player.phone || 'N/A'}\n` +
            `Wallet: ${wallet} ETB\n` +
            `Gift: ${gift} ETB\n` +
            `Wins: ${player.wins}\n` +
            `Joined: ${player.createdAt.toISOString().split('T')[0]}`,
            { parse_mode: 'Markdown' }
        );
    });

    // /present <amount> — gift all players
    bot.onText(/\/present (.+)/, async (msg, match) => {
        const tid = msg.from.id;
        if (!isAdmin(tid)) return;
        const amount = parseFloat(match[1].trim());
        if (isNaN(amount) || amount <= 0) return bot.sendMessage(msg.chat.id, '❌ Invalid amount');

        const count = await prisma.player.count();
        await prisma.player.updateMany({
            data: { gift: { increment: amount } },
        });

        await bot.sendMessage(msg.chat.id, `✅ Gifted ${amount} ETB to all ${count} players`);
    });

    // /top10 — top 10 players by wins
    bot.onText(/\/top10/, async (msg) => {
        const tid = msg.from.id;
        if (!isAdmin(tid)) return;

        const players = await prisma.player.findMany({
            orderBy: { wins: 'desc' },
            take: 10,
        });

        const lines = players.map(
            (p, i) => `${i + 1}. ${p.username || p.telegramId} — ${p.wins} wins (${new Decimal(p.wallet.toString()).toFixed(0)} ETB)`
        );
        await bot.sendMessage(msg.chat.id, `🏆 *Top 10 Players*\n\n${lines.join('\n')}`, {
            parse_mode: 'Markdown',
        });
    });

    // /post <message> — broadcast to all players
    bot.onText(/\/post (.+)/, async (msg, match) => {
        const tid = msg.from.id;
        if (!isAdmin(tid)) return;
        const text = match[1].trim();

        const players = await prisma.player.findMany({ select: { telegramId: true } });
        let sent = 0;
        for (const p of players) {
            try {
                await bot.sendMessage(Number(p.telegramId), text);
                sent++;
            } catch (_) { }
            // Rate limit
            if (sent % 25 === 0) await new Promise((r) => setTimeout(r, 1000));
        }
        await bot.sendMessage(msg.chat.id, `✅ Broadcast sent to ${sent}/${players.length} players`);
    });

    // /add <tid> <amount> — credit player
    bot.onText(/\/add (\d+) (.+)/, async (msg, match) => {
        const tid = msg.from.id;
        if (!isAdmin(tid)) return;

        const targetTid = parseInt(match[1], 10);
        const amount = parseFloat(match[2]);
        if (!targetTid || isNaN(amount) || amount <= 0) {
            return bot.sendMessage(msg.chat.id, '❌ Usage: /add <tid> <amount>');
        }

        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(targetTid) } });
        if (!player) return bot.sendMessage(msg.chat.id, '❌ Player not found');

        await prisma.player.update({
            where: { id: player.id },
            data: { wallet: { increment: amount } },
        });

        await prisma.transaction.create({
            data: {
                playerId: player.id,
                kind: 'admin_credit',
                amount: amount,
                note: `Admin credit by ${tid}`,
                actorTid: BigInt(tid),
            },
        });

        // Notify player
        try {
            await bot.sendMessage(
                targetTid,
                `💰 Your wallet has been credited with *${amount} ETB* by admin.`,
                { parse_mode: 'Markdown' }
            );
        } catch (_) { }

        await bot.sendMessage(msg.chat.id, `✅ Credited ${amount} ETB to ${player.username || targetTid}`);
    });

    // /subtract <tid> <amount> — debit player
    bot.onText(/\/subtract (\d+) (.+)/, async (msg, match) => {
        const tid = msg.from.id;
        if (!isAdmin(tid)) return;

        const targetTid = parseInt(match[1], 10);
        const amount = parseFloat(match[2]);
        if (!targetTid || isNaN(amount) || amount <= 0) {
            return bot.sendMessage(msg.chat.id, '❌ Usage: /subtract <tid> <amount>');
        }

        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(targetTid) } });
        if (!player) return bot.sendMessage(msg.chat.id, '❌ Player not found');

        await prisma.player.update({
            where: { id: player.id },
            data: { wallet: { decrement: amount } },
        });

        await prisma.transaction.create({
            data: {
                playerId: player.id,
                kind: 'admin_debit',
                amount: -amount,
                note: `Admin debit by ${tid}`,
                actorTid: BigInt(tid),
            },
        });

        await bot.sendMessage(msg.chat.id, `✅ Deducted ${amount} ETB from ${player.username || targetTid}`);
    });
}

module.exports = { setupAdmin };

// Admin handler — port of bingo/admin.py
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');
const cache = require('../cache');
const prisma = new PrismaClient();

function getAdminChatId() {
    const id = process.env.ADMIN_CHAT_ID;
    return id ? parseInt(id, 10) : null;
}

function isAdmin(tid) {
    const adminId = getAdminChatId();
    return tid === adminId;
}

async function ensureAdmin(bot, msg) {
    if (!isAdmin(msg.from.id)) {
        await bot.sendMessage(msg.chat.id, 'Command not available.');
        return false;
    }
    return true;
}

function setupAdmin(bot) {
    bot.onText(/\/(admin|help)$/, async(msg) => {
        if (!await ensureAdmin(bot, msg)) return;
        const text =
            'Admin commands:\n' +
            '/username <new_username> — change admin username only\n' +
            '/present — show online players count (last 2 minutes)\n' +
            '/top10 — show top 10 players by wins\n' +
            '/topdaily — top winners today (count and total)\n' +
            '/topweekly — top winners this week (count and total)\n' +
            '/post <message> — broadcast a message (links keep preview)\n' +
            '/post photo <url> [caption] — broadcast an image by URL\n' +
            '/post file <path> [caption] — broadcast a local image from the server\n' +
            '/post playnow [caption] — attach a \'/play\' button (runs in bot)\n' +
            'Tip: Reply to a photo with /post [caption] to broadcast that image';
        await bot.sendMessage(msg.chat.id, text);
    });

    bot.onText(/\/username (.+)/, async(msg, match) => {
        if (!await ensureAdmin(bot, msg)) return;
        const newUname = match[1].trim().replace(/^@/, '').slice(0, 64);
        const adminId = getAdminChatId();
        if (!adminId) return bot.sendMessage(msg.chat.id, 'Admin player record not found');

        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(adminId) } });
        if (!player) return bot.sendMessage(msg.chat.id, 'Admin player record not found');

        const updated = await prisma.player.update({
            where: { id: player.id },
            data: { username: newUname },
        });

        const wallet = new Decimal(updated.wallet.toString()).toFixed(2);
        const gift = new Decimal(updated.gift.toString()).toFixed(2);
        await bot.sendMessage(
            msg.chat.id,
            '```\n' +
            `Telegram ID:   ${updated.telegramId}\n` +
            `Username:      ${updated.username || '-'}\n` +
            `Phone:         ${updated.phone || '-'}\n` +
            `Balance:       ${wallet} ETB\n` +
            `Coin:          ${gift}\n` +
            '```', { parse_mode: 'Markdown' }
        );
    });

    bot.onText(/\/present$/, async(msg) => {
        if (!await ensureAdmin(bot, msg)) return;
        const now = Date.now();
        const players = await prisma.player.findMany({ select: { telegramId: true } });
        let present = 0;
        for (const p of players) {
            const lastSeen = cache.get(`seen_${p.telegramId}`);
            if (lastSeen && now - lastSeen <= 120000) present += 1;
        }
        await bot.sendMessage(msg.chat.id, `Players present (last 2 min): ${present}\nTotal registered: ${players.length}`);
    });

    bot.onText(/\/top10$/, async(msg) => {
        if (!await ensureAdmin(bot, msg)) return;
        const players = await prisma.player.findMany({
            orderBy: [{ wins: 'desc' }, { wallet: 'desc' }],
            take: 10,
        });
        if (!players.length) return bot.sendMessage(msg.chat.id, 'No players found');
        const lines = players.map((p, i) =>
            `${i + 1}. ${p.username || p.telegramId} — ${p.wins || 0} wins — ${new Decimal(p.wallet.toString()).toFixed(2)} ETB`
        );
        await bot.sendMessage(msg.chat.id, `Top 10 players by wins:\n${lines.join('\n')}`);
    });

    bot.onText(/\/(topdaily|topweekly)$/, async(msg, match) => {
        if (!await ensureAdmin(bot, msg)) return;
        const period = match[1] === 'topdaily' ? 'daily' : 'weekly';
        const now = new Date();
        let start;
        let end;
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (period === 'daily') {
            start = startOfToday;
            end = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);
        } else {
            const weekday = startOfToday.getDay();
            const mondayOffset = (weekday + 6) % 7;
            start = new Date(startOfToday.getTime() - mondayOffset * 24 * 60 * 60 * 1000);
            end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
        }

        const wins = await prisma.transaction.findMany({
            where: { kind: 'win', createdAt: { gte: start, lte: end } },
            select: { playerId: true, amount: true },
        });
        if (!wins.length) {
            await bot.sendMessage(msg.chat.id, 'No wins in this period');
            return;
        }

        const agg = new Map();
        for (const w of wins) {
            const row = agg.get(w.playerId) || { count: 0, amount: new Decimal(0) };
            row.count += 1;
            row.amount = row.amount.plus(new Decimal(w.amount.toString()));
            agg.set(w.playerId, row);
        }

        const ids = [...agg.keys()];
        const players = await prisma.player.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, telegramId: true } });
        const byId = new Map(players.map((p) => [p.id, p]));

        const rows = [...agg.entries()].map(([pid, data]) => ({
            player: byId.get(pid),
            count: data.count,
            amount: data.amount,
        })).sort((a, b) => b.count - a.count || b.amount.minus(a.amount).toNumber()).slice(0, 10);

        const lines = rows.map((r, i) => {
            const name = (r.player && r.player.username) || (r.player && r.player.telegramId) || '-';
            return `${i + 1}. ${name} — ${r.count} wins — ${r.amount.toFixed(2)} ETB`;
        });
        const title = period === 'daily' ? 'Top winners TODAY' : 'Top winners THIS WEEK';
        await bot.sendMessage(msg.chat.id, `${title}:\n${lines.join('\n')}`);
    });

    bot.onText(/\/post(.*)/, async(msg, match) => {
        if (!await ensureAdmin(bot, msg)) return;

        const args = (match[1] || '').trim().split(/\s+/).filter(Boolean);
        const hasReplyPhoto = !!(msg.reply_to_message && msg.reply_to_message.photo && msg.reply_to_message.photo.length);
        if (!args.length && !hasReplyPhoto) {
            await bot.sendMessage(msg.chat.id, 'Usage: /post <message> | /post photo <url> [caption] | /post file <path> [caption] | /post playnow [caption] | reply to a photo with /post [caption]');
            return;
        }

        let mode = 'text';
        let photoUrl = null;
        let caption = null;
        let message = args.join(' ');
        let playNowButton = false;

        if (args[0] && args[0].toLowerCase() === 'photo' && args[1]) {
            mode = 'photo';
            photoUrl = args[1];
            caption = args.slice(2).join(' ') || null;
        } else if (args[0] && args[0].toLowerCase() === 'file' && args[1]) {
            const filePath = args[1];
            caption = args.slice(2).join(' ') || null;
            if (!fs.existsSync(filePath)) {
                await bot.sendMessage(msg.chat.id, `File not found: ${filePath}`);
                return;
            }
            const sent = await bot.sendPhoto(msg.chat.id, filePath, { caption, parse_mode: 'Markdown' });
            const fileId = sent && sent.photo && sent.photo.length
                ? sent.photo[sent.photo.length - 1].file_id
                : null;
            if (!fileId) return bot.sendMessage(msg.chat.id, 'Could not upload photo.');
            mode = 'photo';
            photoUrl = fileId;
        } else if (args[0] && args[0].toLowerCase() === 'playnow') {
            playNowButton = true;
            caption = args.slice(1).join(' ') || null;
            if (hasReplyPhoto) {
                mode = 'photo';
                photoUrl = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
                message = caption || msg.reply_to_message.caption || '';
            } else {
                mode = 'text';
                message = caption || message || 'Tap /play to begin';
            }
        } else if (hasReplyPhoto) {
            mode = 'photo';
            photoUrl = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
            caption = message || msg.reply_to_message.caption || null;
        } else if (message && /https?:\/\/.+\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(message)) {
            mode = 'photo';
            photoUrl = message;
            caption = null;
        }

        const replyMarkup = playNowButton ? {
                inline_keyboard: [
                    [{ text: '/play', callback_data: 'play_now' }]
                ]
            } :
            undefined;

        const players = await prisma.player.findMany({ select: { telegramId: true } });
        const tids = [...new Set(players.map((p) => Number(p.telegramId)).filter(Boolean))];

        let sent = 0;
        let failed = 0;
        for (const tid of tids) {
            try {
                if (mode === 'photo' && photoUrl) {
                    await bot.sendPhoto(tid, photoUrl, { caption, parse_mode: 'Markdown', reply_markup: replyMarkup });
                } else {
                    await bot.sendMessage(tid, message, { parse_mode: 'Markdown', disable_web_page_preview: false, reply_markup: replyMarkup });
                }
                sent += 1;
                await new Promise((r) => setTimeout(r, 30));
            } catch (_) {
                failed += 1;
            }
        }

        await bot.sendMessage(msg.chat.id, `Broadcast sent to ${sent} players. Failed: ${failed}`);
    });
}

module.exports = { setupAdmin };
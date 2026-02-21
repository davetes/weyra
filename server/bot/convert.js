// Convert handler — port of bingo/convert.py
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');
const prisma = new PrismaClient();

function setupConvert(bot, userState) {
    bot.onText(/\/convert/, async (msg) => {
        const chatId = msg.chat.id;
        const tid = msg.from.id;
        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
        if (!player) return bot.sendMessage(chatId, 'Please /start first.');

        const gift = new Decimal(player.gift.toString());
        if (gift.lte(0)) {
            return bot.sendMessage(chatId, '❌ You have no gift balance to convert.');
        }

        if (!userState.has(tid)) userState.set(tid, {});
        userState.get(tid).convertStep = 'amount';
        userState.get(tid).maxConvert = parseFloat(gift.toString());

        await bot.sendMessage(
            chatId,
            `🎁 *Convert Gift Balance*\n\nGift balance: *${gift.toFixed(2)} ETB*\n\nEnter amount to convert to wallet (2 wins required per 10 ETB):`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/')) return;
        const chatId = msg.chat.id;
        const tid = msg.from.id;
        const state = userState.get(tid);
        if (!state || state.convertStep !== 'amount') return;

        const amount = parseFloat(msg.text.trim());
        if (isNaN(amount) || amount <= 0) {
            return bot.sendMessage(chatId, '❌ Please enter a valid amount.');
        }
        if (amount > state.maxConvert) {
            return bot.sendMessage(chatId, `❌ You can only convert up to ${state.maxConvert} ETB.`);
        }

        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
        if (!player) return;

        // Check wins requirement (2 wins per 10 ETB)
        const winsRequired = Math.ceil(amount / 10) * 2;
        if (player.wins < winsRequired) {
            userState.delete(tid);
            return bot.sendMessage(
                chatId,
                `❌ You need at least ${winsRequired} wins to convert ${amount} ETB. You have ${player.wins} wins.`
            );
        }

        // Execute conversion
        await prisma.player.update({
            where: { id: player.id },
            data: {
                gift: { decrement: amount },
                wallet: { increment: amount },
            },
        });

        await prisma.transaction.create({
            data: {
                playerId: player.id,
                kind: 'convert',
                amount: amount,
                note: `Converted ${amount} ETB from gift to wallet`,
            },
        });

        userState.delete(tid);
        return bot.sendMessage(
            chatId,
            `✅ Successfully converted *${amount} ETB* from gift to wallet!`,
            { parse_mode: 'Markdown' }
        );
    });
}

module.exports = { setupConvert };

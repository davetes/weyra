// Transfer handler — port of bingo/transfer.py
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');
const prisma = new PrismaClient();

function setupTransfer(bot, userState) {
    bot.onText(/\/transfer/, async (msg) => {
        const chatId = msg.chat.id;
        const tid = msg.from.id;
        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
        if (!player) return bot.sendMessage(chatId, 'Please /start first.');

        const wallet = new Decimal(player.wallet.toString());
        if (wallet.lt(10)) {
            return bot.sendMessage(chatId, '❌ Minimum transfer is 10 ETB. Your balance is insufficient.');
        }

        if (!userState.has(tid)) userState.set(tid, {});
        userState.get(tid).transferStep = 'phone';

        await bot.sendMessage(
            chatId,
            `🔄 *Transfer Balance*\n\nYour wallet: *${wallet.toFixed(2)} ETB*\n\nEnter recipient phone number or username:`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/')) return;
        const chatId = msg.chat.id;
        const tid = msg.from.id;
        const state = userState.get(tid);
        if (!state) return;

        if (state.transferStep === 'phone') {
            const target = msg.text.trim();
            // Find recipient by phone or username
            let recipient = await prisma.player.findFirst({
                where: {
                    OR: [
                        { phone: target },
                        { username: target.replace('@', '') },
                    ],
                },
            });
            if (!recipient) {
                return bot.sendMessage(chatId, '❌ Recipient not found. Check the phone/username and try again.');
            }
            if (recipient.telegramId === BigInt(tid)) {
                return bot.sendMessage(chatId, '❌ Cannot transfer to yourself.');
            }
            state.transferRecipientId = recipient.id;
            state.transferRecipientName = recipient.username || recipient.phone || 'Player';
            state.transferStep = 'amount';
            return bot.sendMessage(chatId, `Enter amount to transfer to *${state.transferRecipientName}*:`, {
                parse_mode: 'Markdown',
            });
        }

        if (state.transferStep === 'amount') {
            const amount = parseFloat(msg.text.trim());
            if (isNaN(amount) || amount < 10) {
                return bot.sendMessage(chatId, '❌ Minimum transfer is 10 ETB.');
            }

            const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
            if (!player || new Decimal(player.wallet.toString()).lt(amount)) {
                userState.delete(tid);
                return bot.sendMessage(chatId, '❌ Insufficient balance. Transfer cancelled.');
            }

            // Execute transfer
            await prisma.player.update({
                where: { id: player.id },
                data: { wallet: { decrement: amount } },
            });
            await prisma.player.update({
                where: { id: state.transferRecipientId },
                data: { wallet: { increment: amount } },
            });

            // Record transactions
            await prisma.transaction.create({
                data: {
                    playerId: player.id,
                    kind: 'transfer_out',
                    amount: -amount,
                    note: `Transfer to ${state.transferRecipientName}`,
                },
            });
            await prisma.transaction.create({
                data: {
                    playerId: state.transferRecipientId,
                    kind: 'transfer_in',
                    amount: amount,
                    note: `Transfer from ${player.username || tid}`,
                    actorTid: BigInt(tid),
                },
            });

            // Notify recipient
            const recipient = await prisma.player.findUnique({ where: { id: state.transferRecipientId } });
            if (recipient) {
                try {
                    await bot.sendMessage(
                        Number(recipient.telegramId),
                        `💰 You received *${amount} ETB* from ${player.username || 'a player'}!`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (_) { }
            }

            userState.delete(tid);
            return bot.sendMessage(
                chatId,
                `✅ Successfully transferred *${amount} ETB* to ${state.transferRecipientName}`,
                { parse_mode: 'Markdown' }
            );
        }
    });
}

module.exports = { setupTransfer };

// Withdraw handler — port of bingo/withdraw.py
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');
const prisma = new PrismaClient();

function setupWithdraw(bot, userState) {
    bot.onText(/\/withdraw/, async (msg) => {
        const chatId = msg.chat.id;
        const tid = msg.from.id;
        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
        if (!player) return bot.sendMessage(chatId, 'Please /start first.');

        const wallet = new Decimal(player.wallet.toString());
        if (wallet.lt(10)) {
            return bot.sendMessage(chatId, '❌ Minimum withdrawal is 10 ETB. Your balance is insufficient.');
        }

        if (!userState.has(tid)) userState.set(tid, {});
        userState.get(tid).withdrawStep = 'amount';

        await bot.sendMessage(
            chatId,
            `💰 Your wallet: *${wallet.toFixed(2)} ETB*\n\nEnter amount to withdraw (min 10 ETB):`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/')) return;
        const chatId = msg.chat.id;
        const tid = msg.from.id;
        const state = userState.get(tid);
        if (!state) return;

        if (state.withdrawStep === 'amount') {
            const amount = parseFloat(msg.text.trim());
            if (isNaN(amount) || amount < 10) {
                return bot.sendMessage(chatId, '❌ Please enter a valid amount (minimum 10 ETB).');
            }
            const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
            if (!player || new Decimal(player.wallet.toString()).lt(amount)) {
                return bot.sendMessage(chatId, '❌ Insufficient balance.');
            }
            state.withdrawAmount = amount;
            state.withdrawStep = 'method';
            return bot.sendMessage(chatId, 'Choose withdrawal method:', {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'Telebirr', callback_data: 'wd_telebirr' },
                            { text: 'BOA', callback_data: 'wd_boa' },
                        ],
                        [
                            { text: 'CBE', callback_data: 'wd_cbe' },
                            { text: 'Awash', callback_data: 'wd_awash' },
                        ],
                    ],
                },
            });
        }

        if (state.withdrawStep === 'account') {
            const account = msg.text.trim();
            const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
            if (!player) return;

            const amount = state.withdrawAmount;
            if (new Decimal(player.wallet.toString()).lt(amount)) {
                userState.delete(tid);
                return bot.sendMessage(chatId, '❌ Insufficient balance. Withdrawal cancelled.');
            }

            // Deduct from wallet
            await prisma.player.update({
                where: { id: player.id },
                data: { wallet: { decrement: amount } },
            });

            await prisma.transaction.create({
                data: {
                    playerId: player.id,
                    kind: 'withdraw',
                    amount: -amount,
                    note: `Withdraw ${amount} ETB via ${state.withdrawMethod} to ${account}`,
                },
            });

            // Notify admin
            const adminChatId = process.env.ADMIN_CHAT_ID;
            if (adminChatId) {
                try {
                    await bot.sendMessage(
                        adminChatId,
                        `📤 *Withdrawal Request*\n\n` +
                        `Player: ${player.username || tid}\n` +
                        `Amount: ${amount} ETB\n` +
                        `Method: ${state.withdrawMethod}\n` +
                        `Account: ${account}`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (_) { }
            }

            userState.delete(tid);
            return bot.sendMessage(
                chatId,
                `✅ Withdrawal of *${amount} ETB* submitted!\n\nYou will receive your funds shortly.`,
                { parse_mode: 'Markdown' }
            );
        }
    });

    // Handle withdraw method selection callback
    bot.on('callback_query', async (query) => {
        const tid = query.from.id;
        const state = userState.get(tid);
        if (!state || state.withdrawStep !== 'method') return;
        if (!query.data.startsWith('wd_')) return;

        await bot.answerCallbackQuery(query.id);
        const methods = { wd_telebirr: 'Telebirr', wd_boa: 'BOA', wd_cbe: 'CBE', wd_awash: 'Awash' };
        state.withdrawMethod = methods[query.data] || query.data;
        state.withdrawStep = 'account';

        await bot.sendMessage(
            query.message.chat.id,
            `Enter your ${state.withdrawMethod} account number/phone:`
        );
    });
}

module.exports = { setupWithdraw };

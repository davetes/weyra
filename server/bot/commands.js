// Bot command handlers — port of bingo/bot.py
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('decimal.js');
const { buildDepositKeyboard, handleDepositSelection } = require('./deposit');
const { setupWithdraw } = require('./withdraw');
const { setupTransfer } = require('./transfer');
const { setupConvert } = require('./convert');
const { setupInvite } = require('./invite');
const { setupReport } = require('./report');

const prisma = new PrismaClient();

// Conversation state (replaces python-telegram-bot context.user_data)
const userState = new Map();

function getUserState(uid) {
    if (!userState.has(uid)) userState.set(uid, {});
    return userState.get(uid);
}

function clearUserState(uid) {
    userState.delete(uid);
}

const BUTTON_ROWS = [
    [{ text: '🎮 Play Now', callback_data: 'play_now' }],
    [
        { text: '💰 Check Balance', callback_data: 'check_balance' },
        { text: '💸 Make a Deposit', callback_data: 'deposit' },
    ],
    [
        { text: 'Support 📞', callback_data: 'support' },
        { text: '📖 Instructions', callback_data: 'instructions' },
    ],
    [
        { text: '✉️ Invite', callback_data: 'invite' },
        { text: 'Win Patterns', callback_data: 'win_patterns' },
    ],
];

function buildStakeKeyboard(tid) {
    const WEBAPP_URL = (process.env.WEBAPP_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
    const withTid = tid ? `&tid=${tid}` : '';
    return {
        inline_keyboard: [
            [
                { text: '🎮 10 ETB', web_app: { url: `${WEBAPP_URL}/play?stake=10${withTid}` } },
                { text: '🎮 20 ETB', web_app: { url: `${WEBAPP_URL}/play?stake=20${withTid}` } },
            ],
            [
                { text: '🎮 50 ETB', web_app: { url: `${WEBAPP_URL}/play?stake=50${withTid}` } },
                { text: '🎮 100 ETB', web_app: { url: `${WEBAPP_URL}/play?stake=100${withTid}` } },
            ],
        ],
    };
}

async function ensurePhoneRegistered(bot, chatId, player) {
    if (player && player.phone && player.phone.trim().length > 0) return true;

    await bot.sendMessage(chatId, 'Please Share Your Phone Number', {
        reply_markup: {
            keyboard: [[{ text: 'Share Phone Number', request_contact: true }, { text: 'Cancel' }]],
            resize_keyboard: true,
            one_time_keyboard: true,
            input_field_placeholder: "Tap 'Share Phone Number'",
        },
    });
    return false;
}

function setupCommands(bot) {

    // /start — register + welcome
    bot.onText(/\/start(.*)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const tid = msg.from.id;
        const username = msg.from.username || '';
        const refParam = (match[1] || '').trim();

        // Find or create player
        let player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
        const isNew = !player;
        if (!player) {
            player = await prisma.player.create({
                data: {
                    telegramId: BigInt(tid),
                    username,
                },
            });
        } else {
            // Update username
            if (username && username !== player.username) {
                await prisma.player.update({
                    where: { id: player.id },
                    data: { username },
                });
            }
        }

        // Capture referral for first-time registration completion
        if (refParam.startsWith('ref_')) {
            const refTid = parseInt(refParam.replace('ref_', ''), 10);
            if (refTid && refTid !== tid) {
                const state = getUserState(tid);
                state.referrerTid = refTid;
            }
        }

        const imgUrl = process.env.START_IMAGE_URL;
        const imgPath = process.env.START_IMAGE_PATH;
        const welcome = '🕹️ Every Square Counts – Grab Your roha, Join the Game, and Let the Fun Begin!';
        if (imgUrl) {
            try { await bot.sendPhoto(chatId, imgUrl, { caption: '🎉 Welcome To roha Bingo! 🎉' }); } catch (_) { }
        } else if (imgPath) {
            try {
                const resolved = path.isAbsolute(imgPath) ? imgPath : path.join(process.cwd(), imgPath);
                if (fs.existsSync(resolved)) {
                    await bot.sendPhoto(chatId, resolved, { caption: '🎉 Welcome To roha Bingo! 🎉' });
                }
            } catch (_) { }
        }
        await bot.sendMessage(chatId, welcome, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: BUTTON_ROWS },
        });

        await ensurePhoneRegistered(bot, chatId, player);
    });

    // /play — open web app
    bot.onText(/\/play/, async (msg) => {
        const chatId = msg.chat.id;
        const tid = msg.from.id;
        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
        const ok = await ensurePhoneRegistered(bot, chatId, player);
        if (!ok) return;

        await bot.sendMessage(chatId, '💰 Choose Your Stake, Play Your Luck — The Bigger the Bet, The Bigger the Glory!', {
            parse_mode: 'HTML',
            reply_markup: buildStakeKeyboard(tid),
        });
    });

    // /deposit — show deposit options
    bot.onText(/\/deposit/, async (msg) => {
        const chatId = msg.chat.id;
        const tid = msg.from.id;
        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
        const ok = await ensurePhoneRegistered(bot, chatId, player);
        if (!ok) return;

        await bot.sendMessage(chatId, 'Please select the bank option you wish to use for the top-up.', {
            reply_markup: buildDepositKeyboard(),
        });
    });

    // /balance
    bot.onText(/\/balance/, async (msg) => {
        const chatId = msg.chat.id;
        const tid = msg.from.id;
        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
        if (!player) {
            return bot.sendMessage(chatId, 'Please /start first to register.');
        }
        const wallet = new Decimal(player.wallet.toString()).toFixed(2);
        const gift = new Decimal(player.gift.toString()).toFixed(2);
        await bot.sendMessage(
            chatId,
            '```\n' +
            `Username:      ${player.username || '-'}\n` +
            `Balance:       ${wallet} ETB\n` +
            `Coin:          ${gift}\n` +
            '```',
            { parse_mode: 'Markdown' }
        );
    });

    // /instruction
    bot.onText(/\/instruction/, async (msg) => {
        await bot.sendMessage(
            msg.chat.id,
            'እንኮን ወደ ሮሃ ቢንጎ መጡ\n\n' +
            '1 ለመጫወት ወደቦቱ ሲገቡ register የሚለውን በመንካት ስልክ ቁጥሮትን ያጋሩ\n\n' +
            '2 menu ውስጥ በመግባት deposit fund የሚለውን በመንካት በሚፈልጉት የባንክ አካውንት ገንዘብ ገቢ ያድርጉ \n\n' +
            '3 menu ውስጥ በመግባት start play የሚለውን በመንካት መወራረድ የሚፈልጉበትን የብር መጠን ይምረጡ።\n\n\n' +
            '1 ወደጨዋታው እድገቡ ከሚመጣሎት 100 የመጫወቻ ቁጥሮች መርጠው accept የሚለውን በመንካት የቀጥሉ\n\n' +
            '2 ጨዋታው ለመጀመር የተሰጠውን ጊዜ ሲያልቅ ቁጥሮች መውጣት ይጀምራል\n\n' +
            '3 የሚወጡት ቁጥሮች የመረጡት ካርቴላ ላይ መኖሩን እያረጋገጡ ያቅልሙ\n\n' +
            '4 ያቀለሙት አንድ መስመር ወይንም አራት ጠርዝ ላይ ሲመጣ ቢንጎ በማለት ማሸነፍ የችላሉ\n\n' +
            ' —አንድ መስመር ማለት\n' +
            '    አንድ ወደጎን ወይንም ወደታች ወይንም ዲያጎናል ሲዘጉ\n\n' +
            ' — አራት ጠርዝ ልይ ሲመጣሎት \n\n' +
            '5 እነዚህ ማሸነፊያ ቁጥሮች ሳይመጣሎት bingo እሚለውን ከነኩ ከጨዋታው ይባረራሉ\n\n' +
            'ማሳሰቢያ\n\n' +
            '1 የጨዋታ ማስጀመሪያ ሰከንድ (countdown) ሲያልቅ ያሉት ተጫዋች ብዛት ከ2 በታች ከሆነ ያ ጨዋታ አይጀመርም \n' +
            '2 ጨዋታ ከጀመረ በህዋላ ካርቴላ መምረጫ ቦርዱ ይፀዳል\n' +
            '3 እርሶ በዘጉበት ቁጥር ሌላ ተጫዋች ዘግቶ ቀድሞ bingo ካለ አሸናፊነትዋን ያጣሉ\n\n' +
            '📝ስለሆነም እንዚህን ማሳሰቢያዎች ተመልክተው እንዲጠቀሙበት ካርቴላ ቢንጎ ያሳስባል'
        );
    });

    // /contact
    bot.onText(/\/contact/, async (msg) => {
        await bot.sendMessage(
            msg.chat.id,
            'Telegram - @Rohabingosupport\nPhone - +251981959155'
        );
    });

    // Handle contact sharing
    bot.on('message', async (msg) => {
        if (msg.contact) {
            const tid = msg.from.id;
            const phone = msg.contact.phone_number || '';
            let player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
            if (!player) {
                player = await prisma.player.create({
                    data: { telegramId: BigInt(tid), username: msg.from.username || '', phone },
                });
            }

            const firstPhone = !player.phone && phone;
            if (firstPhone) {
                const bonus = new Decimal(10);
                const updated = await prisma.player.update({
                    where: { id: player.id },
                    data: {
                        phone,
                        username: msg.from.username || player.username || '',
                        wallet: { increment: parseFloat(bonus.toString()) },
                    },
                });
                await bot.sendMessage(
                    msg.chat.id,
                    `Registration completed. You received 10 ETB. Wallet: ${new Decimal(updated.wallet.toString()).toFixed(2)}`,
                    { reply_markup: { remove_keyboard: true } }
                );

                // Reward referrer
                const state = getUserState(tid);
                const refTid = state.referrerTid;
                if (refTid && refTid !== tid) {
                    const referrer = await prisma.player.findUnique({ where: { telegramId: BigInt(refTid) } });
                    if (referrer) {
                        const refBonus = new Decimal(2);
                        const updated = await prisma.player.update({
                            where: { id: referrer.id },
                            data: { wallet: { increment: parseFloat(refBonus.toString()) } },
                        });
                        try {
                            await bot.sendMessage(
                                refTid,
                                `🎉 Referral bonus received!\nA new player joined using your link. +2.00 ETB\nNew Wallet: ${new Decimal(updated.wallet.toString()).toFixed(2)} ETB`
                            );
                        } catch (_) { }
                    }
                }
            } else {
                await prisma.player.update({
                    where: { id: player.id },
                    data: { phone, username: msg.from.username || player.username || '' },
                });
                await bot.sendMessage(msg.chat.id, 'Registration completed. Thank you.', { reply_markup: { remove_keyboard: true } });
            }

            await bot.sendMessage(msg.chat.id, '🕹️ Every Square Counts – Grab Your luckbet, Join the Game, and Let the Fun Begin!', {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: BUTTON_ROWS },
            });
            return;
        }

        if (!msg.text || msg.text.startsWith('/')) return;
        const chatId = msg.chat.id;
        const text = msg.text.trim();

        if (text === 'Cancel') {
            await bot.sendMessage(chatId, 'Cancelled.', { reply_markup: { remove_keyboard: true } });
            return;
        }

        if (text === '💰 Balance') {
            bot.emit('text', msg, [null, null]); // trigger /balance
            const tid = msg.from.id;
            const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
            if (!player) return bot.sendMessage(chatId, 'Please /start first.');
            const wallet = new Decimal(player.wallet.toString()).toFixed(2);
            const gift = new Decimal(player.gift.toString()).toFixed(2);
            return bot.sendMessage(chatId, `💰 Wallet: ${wallet} ETB | Gift: ${gift} ETB | Wins: ${player.wins}`);
        }

        if (text === '💳 Deposit') {
            return bot.processUpdate({ message: { ...msg, text: '/deposit' } });
        }
        if (text === '📤 Withdraw') {
            return bot.processUpdate({ message: { ...msg, text: '/withdraw' } });
        }
        if (text === '🔄 Transfer') {
            return bot.processUpdate({ message: { ...msg, text: '/transfer' } });
        }
        if (text === '🎁 Invite') {
            return bot.processUpdate({ message: { ...msg, text: '/invite' } });
        }
        if (text === '📋 Instruction') {
            return bot.processUpdate({ message: { ...msg, text: '/instruction' } });
        }
    });

    // Inline button callbacks (menu, deposit, etc.)
    bot.on('callback_query', async (query) => {
        const data = query.data || '';
        const chatId = query.message?.chat?.id;
        const tid = query.from?.id;
        if (!chatId || !tid) return;

        if (data.startsWith('copy_tid:')) {
            const tidToCopy = data.split(':', 2)[1];
            try { await bot.answerCallbackQuery(query.id, { text: `User ID: ${tidToCopy}`, show_alert: true }); } catch (_) { }
            return;
        }

        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
        const registered = await ensurePhoneRegistered(bot, chatId, player);
        if (!registered) {
            await bot.answerCallbackQuery(query.id).catch(() => {});
            return;
        }

        if (data.startsWith('deposit_')) {
            await bot.answerCallbackQuery(query.id).catch(() => {});
            await handleDepositSelection(bot, chatId, data);
            return;
        }

        if (data === 'play_now') {
            await bot.answerCallbackQuery(query.id).catch(() => {});
            await bot.sendMessage(chatId, '💰 Choose Your Stake, Play Your Luck — The Bigger the Bet, The Bigger the Glory!', {
                parse_mode: 'HTML',
                reply_markup: buildStakeKeyboard(tid),
            });
            return;
        }

        if (data === 'deposit') {
            await bot.answerCallbackQuery(query.id).catch(() => {});
            await bot.sendMessage(chatId, 'Please select the bank option you wish to use for the top-up.', {
                reply_markup: buildDepositKeyboard(),
            });
            return;
        }

        if (data === 'check_balance') {
            await bot.answerCallbackQuery(query.id).catch(() => {});
            const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
            if (!player) {
                await bot.sendMessage(chatId, 'Unable to retrieve your balance at the moment.');
                return;
            }
            const wallet = new Decimal(player.wallet.toString()).toFixed(2);
            const gift = new Decimal(player.gift.toString()).toFixed(2);
            await bot.sendMessage(chatId, '```\n' +
                `Username:      ${player.username || '-'}\n` +
                `Balance:       ${wallet} ETB\n` +
                `Coin:          ${gift}\n` +
                '```',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        if (data === 'support') {
            await bot.answerCallbackQuery(query.id).catch(() => {});
            await bot.sendMessage(chatId, 'Telegram - @Rohabingosupport\nPhone - +251981959155');
            return;
        }

        if (data === 'instructions') {
            await bot.answerCallbackQuery(query.id).catch(() => {});
            await bot.sendMessage(chatId,
                'እንኮን ወደ ሮሃ ቢንጎ መጡ\n\n' +
                '1 ለመጫወት ወደቦቱ ሲገቡ register የሚለውን በመንካት ስልክ ቁጥሮትን ያጋሩ\n\n' +
                '2 menu ውስጥ በመግባት deposit fund የሚለውን በመንካት በሚፈልጉት የባንክ አካውንት ገንዘብ ገቢ ያድርጉ \n\n' +
                '3 menu ውስጥ በመግባት start play የሚለውን በመንካት መወራረድ የሚፈልጉበትን የብር መጠን ይምረጡ።\n\n\n' +
                '1 ወደጨዋታው እድገቡ ከሚመጣሎት 100 የመጫወቻ ቁጥሮች መርጠው accept የሚለውን በመንካት የቀጥሉ\n\n' +
                '2 ጨዋታው ለመጀመር የተሰጠውን ጊዜ ሲያልቅ ቁጥሮች መውጣት ይጀምራል\n\n' +
                '3 የሚወጡት ቁጥሮች የመረጡት ካርቴላ ላይ መኖሩን እያረጋገጡ ያቅልሙ\n\n' +
                '4 ያቀለሙት አንድ መስመር ወይንም አራት ጠርዝ ላይ ሲመጣ ቢንጎ በማለት ማሸነፍ የችላሉ\n\n' +
                ' —አንድ መስመር ማለት\n' +
                '    አንድ ወደጎን ወይንም ወደታች ወይንም ዲያጎናል ሲዘጉ\n\n' +
                ' — አራት ጠርዝ ልይ ሲመጣሎት \n\n' +
                '5 እነዚህ ማሸነፊያ ቁጥሮች ሳይመጣሎት bingo እሚለውን ከነኩ ከጨዋታው ይባረራሉ\n\n' +
                'ማሳሰቢያ\n\n' +
                '1 የጨዋታ ማስጀመሪያ ሰከንድ (countdown) ሲያልቅ ያሉት ተጫዋች ብዛት ከ2 በታች ከሆነ ያ ጨዋታ አይጀመርም \n' +
                '2 ጨዋታ ከጀመረ በህዋላ ካርቴላ መምረጫ ቦርዱ ይፀዳል\n' +
                '3 እርሶ በዘጉበት ቁጥር ሌላ ተጫዋች ዘግቶ ቀድሞ bingo ካለ አሸናፊነትዋን ያጣሉ\n\n' +
                '📝ስለሆነም እንዚህን ማሳሰቢያዎች ተመልክተው እንዲጠቀሙበት ካርቴላ ቢንጎ ያሳስባል'
            );
            return;
        }

        if (data === 'invite') {
            await bot.answerCallbackQuery(query.id).catch(() => {});
            const botInfo = await bot.getMe();
            const link = `https://t.me/${botInfo.username}?start=ref_${tid}`;
            await bot.sendMessage(
                chatId,
                `🎁 *Invite Friends*\n\nShare your referral link:\n\`${link}\`\n\nYou'll receive *2 ETB* for each new player who joins using your link!`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '📤 Share Link', switch_inline_query: `Join Roha Bingo! ${link}` }]],
                    },
                }
            );
            return;
        }

        if (data === 'win_patterns') {
            await bot.answerCallbackQuery(query.id).catch(() => {});
            const caption = '🎯 From straight lines to funky shapes – every pattern is a chance to WIN BIG! Know the pattern, play smart, and shout BINGO when the stars align!';
            const imgUrl = process.env.WIN_PATTERNS_IMAGE_URL;
            const imgPath = process.env.WIN_PATTERNS_IMAGE_PATH;
            if (imgUrl) {
                try {
                    await bot.sendPhoto(chatId, imgUrl, { caption });
                    return;
                } catch (_) { }
            } else if (imgPath) {
                try {
                    const resolved = path.isAbsolute(imgPath) ? imgPath : path.join(process.cwd(), imgPath);
                    if (fs.existsSync(resolved)) {
                        await bot.sendPhoto(chatId, resolved, { caption });
                        return;
                    }
                } catch (_) { }
            }
            await bot.sendMessage(chatId, caption);
        }
    });

    // Register sub-modules
    setupWithdraw(bot, userState);
    setupTransfer(bot, userState);
    setupConvert(bot, userState);
    setupInvite(bot);
    setupReport(bot);

    async function forwardReceipt(msg) {
        const adminChatId = process.env.ENTERTAINER_ID;
        if (!adminChatId) return;
        const tid = msg.from.id;
        const player = await prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
        const username = player?.username || msg.from.username || '-';
        const phone = player?.phone || '-';
        const caption = msg.caption || '';

        try {
            await bot.forwardMessage(adminChatId, msg.chat.id, msg.message_id);
        } catch (_) { }

        const meta =
            'Receipt forwarded\n' +
            `User: @${username} (id: <code>${tid}</code>)\n` +
            `Phone: ${phone}\n` +
            `caption:${caption}`;

        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Open User', url: `tg://user?id=${tid}` },
                    { text: 'Copy ID', callback_data: `copy_tid:${tid}` },
                ],
            ],
        };

        try {
            await bot.sendMessage(adminChatId, meta, { parse_mode: 'HTML', reply_markup: replyMarkup });
        } catch (_) { }

        try {
            await bot.sendMessage(msg.chat.id, 'Your receipt has been forwarded for verification. Thank you.');
        } catch (_) { }
    }

    // Handle receipt photos or image documents (deposit confirmation)
    bot.on('photo', forwardReceipt);
    bot.on('document', async (msg) => {
        if (msg.document?.mime_type && msg.document.mime_type.startsWith('image/')) {
            await forwardReceipt(msg);
        }
    });
}

module.exports = { setupCommands, userState };

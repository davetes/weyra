// Telegram Bot entry — port of bingo/bot.py
const TelegramBot = require('node-telegram-bot-api');
const { setupCommands } = require('./commands');
const { setupAdmin } = require('./admin');
const { setupEntertainer } = require('./entertainer');

let bot = null;

function startBot() {
    const token = process.env.BOT_TOKEN;
    if (!token || token === 'your-telegram-bot-token') {
        console.warn('⚠️  BOT_TOKEN not set, Telegram bot disabled');
        return;
    }

    bot = new TelegramBot(token, { polling: true });

    // Set bot commands
    bot.setMyCommands([
        { command: 'start', description: 'Start / Register' },
        { command: 'play', description: 'Play Bingo' },
        { command: 'balance', description: 'Check balance' },
        { command: 'deposit', description: 'Deposit money' },
        { command: 'withdraw', description: 'Withdraw money' },
        { command: 'transfer', description: 'Transfer money' },
        { command: 'convert', description: 'Convert gift balance' },
        { command: 'invite', description: 'Invite friends' },
        { command: 'instruction', description: 'How to play' },
        { command: 'contact', description: 'Contact support' },
    ]);

    setupCommands(bot);
    setupAdmin(bot);
    setupEntertainer(bot);

    bot.on('polling_error', (err) => {
        console.error('Bot polling error:', err.message);
    });

    console.log('🤖 Telegram bot polling started');
}

function getBot() {
    return bot;
}

module.exports = { startBot, getBot };

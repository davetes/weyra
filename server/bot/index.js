// Telegram Bot entry — port of bingo/bot.py
const TelegramBot = require("node-telegram-bot-api");
const { setupCommands } = require("./commands");
const { setupAdmin } = require("./admin");
const { setupEntertainer } = require("./entertainer");

let bot = null;
let retryCount = 0;
const MAX_RETRIES = 10;
const RETRY_DELAY = 5000; // 5 seconds

function startBot() {
  const token = process.env.BOT_TOKEN;
  if (!token || token === "your-telegram-bot-token") {
    console.warn("⚠️  BOT_TOKEN not set, Telegram bot disabled");
    return;
  }

  bot = new TelegramBot(token, {
    polling: {
      autoStart: true,
      params: {
        timeout: 30,
      },
    },
  });

  // Set bot commands
  bot.setMyCommands([
    { command: "start", description: "Start / Register" },
    { command: "play", description: "Play Bingo" },
    { command: "balance", description: "Check balance" },
    { command: "deposit", description: "Deposit money" },
    { command: "withdraw", description: "Withdraw money" },
    { command: "invite", description: "Invite friends" },
    { command: "instruction", description: "How to play" },
    { command: "contact", description: "Contact support" },
  ]);

  setupCommands(bot);
  setupAdmin(bot);
  setupEntertainer(bot);

  bot.on("polling_error", (err) => {
    const errorMsg = err.message || err.code || "Unknown error";
    console.error(`Bot polling error: ${errorMsg}`);

    // Handle network-related errors with retry
    if (
      errorMsg.includes("EFATAL") ||
      errorMsg.includes("ECONNREFUSED") ||
      errorMsg.includes("ENOTFOUND") ||
      errorMsg.includes("ETIMEDOUT") ||
      errorMsg.includes("AggregateError")
    ) {
      retryCount++;
      if (retryCount <= MAX_RETRIES) {
        console.log(
          `🔄 Network error, retrying in ${RETRY_DELAY / 1000}s... (attempt ${retryCount}/${MAX_RETRIES})`,
        );
        setTimeout(() => {
          bot
            .stopPolling()
            .then(() => {
              bot.startPolling();
            })
            .catch(() => {
              bot.startPolling();
            });
        }, RETRY_DELAY);
      } else {
        console.error("❌ Max retries reached. Check your network connection.");
      }
    }
  });

  // Reset retry count on successful poll
  bot.on("message", () => {
    if (retryCount > 0) {
      console.log("✅ Bot connection restored");
      retryCount = 0;
    }
  });

  console.log("🤖 Telegram bot polling started");
}

function getBot() {
  return bot;
}

module.exports = { startBot, getBot };

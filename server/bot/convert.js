// Convert handler — port of bingo/convert.py
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const prisma = new PrismaClient();

function setupConvert(bot, userState) {
  bot.onText(/\/convert/, async (msg) => {
    const chatId = msg.chat.id;
    const tid = msg.from.id;

    const player = await prisma.player.findUnique({
      where: { telegramId: BigInt(tid) },
    });
    if (!player)
      return bot.sendMessage(
        chatId,
        "Please register first using /start and share your phone number.",
      );

    if (!userState.has(tid)) userState.set(tid, {});
    const state = userState.get(tid);
    state.convertStep = "amount";

    await bot.sendMessage(
      chatId,
      "Please enter the amount you want to convert:",
      {
        reply_markup: { remove_keyboard: true },
      },
    );

    const wallet = new Decimal(player.wallet.toString());
    const gift = new Decimal(player.gift.toString());
    await bot.sendMessage(
      chatId,
      "```\n" +
        `Username:     ${player.username || "-"}\n` +
        `Balance:      ${wallet.toFixed(2)} ETB\n` +
        `Coin:         ${gift.toFixed(2)}\n` +
        "```",
      { parse_mode: "Markdown" },
    );
  });

  bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;
    const chatId = msg.chat.id;
    const tid = msg.from.id;
    const state = userState.get(tid);
    if (!state || state.convertStep !== "amount") return;

    const text = msg.text.trim();
    if (text.toLowerCase() === "cancel") {
      userState.delete(tid);
      await bot.sendMessage(chatId, "Conversion cancelled.");
      return;
    }

    let amount;
    try {
      amount = new Decimal(text);
    } catch (_) {
      amount = null;
    }
    if (!amount) {
      await bot.sendMessage(chatId, "Please enter a valid number amount.");
      return;
    }
    if (amount.lte(0)) {
      await bot.sendMessage(chatId, "Amount must be greater than 0.");
      return;
    }

    const player = await prisma.player.findUnique({
      where: { telegramId: BigInt(tid) },
    });
    if (!player) {
      await bot.sendMessage(
        chatId,
        "Please register first using /start and share your phone number.",
      );
      userState.delete(tid);
      return;
    }

    const gift = new Decimal(player.gift.toString());
    if (gift.lt(amount)) {
      await bot.sendMessage(chatId, "Insufficient coin to convert.");
      return;
    }

    const updated = await prisma.player.update({
      where: { id: player.id },
      data: {
        gift: gift.minus(amount).toNumber(),
        wallet: new Decimal(player.wallet.toString()).plus(amount).toNumber(),
      },
    });

    userState.delete(tid);

    await bot.sendMessage(
      chatId,
      "```\n" +
        `Balance:      ${new Decimal(updated.wallet.toString()).toFixed(2)} ETB\n` +
        `Coin:         ${new Decimal(updated.gift.toString()).toFixed(2)}\n` +
        "```",
      { parse_mode: "Markdown" },
    );
  });
}

module.exports = { setupConvert };

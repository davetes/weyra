// Convert handler — port of bingo/convert.py
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const prisma = new PrismaClient();

function setupConvert(bot, userState) {
  // Helper to reset conversation state when starting convert
  function resetState(state) {
    // Clear deposit flow
    state.lastDepositMethod = null;
    state.depositAmount = null;
    state.awaitingDepositAmount = false;
    state.awaitingDepositReceipt = false;
    // Clear withdraw flow
    state.withdrawStep = null;
    state.withdraw = null;
    // Clear transfer flow
    state.transferStep = null;
    state.transfer = null;
    // Clear report flow
    state.reportStep = null;
    state.report = null;
  }

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
    resetState(state); // Cancel any previous unfinished command
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
        `Play Wallet:  ${gift.toFixed(2)}\n` +
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
    if (text.toLowerCase() === "cancel" || text === "Cancel / ሰርዝ" || text === "ሰርዝ") {
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

    // Use transaction to prevent TOCTOU race on balance
    const updated = await prisma.$transaction(async (tx) => {
      const freshPlayer = await tx.player.findUnique({
        where: { telegramId: BigInt(tid) },
      });
      if (!freshPlayer) {
        throw new Error("not_found");
      }
      const freshGift = new Decimal(freshPlayer.gift.toString());
      if (freshGift.lt(amount)) {
        throw new Error("insufficient");
      }
      return tx.player.update({
        where: { id: freshPlayer.id },
        data: {
          gift: freshGift.minus(amount).toNumber(),
          wallet: new Decimal(freshPlayer.wallet.toString()).plus(amount).toNumber(),
        },
      }).then(async (updatedPlayer) => {
        await tx.transaction.create({
          data: {
            playerId: freshPlayer.id,
            kind: "convert",
            amount: amount.toNumber(),
            note: `Converted ${amount.toFixed(2)} from Play Wallet to Main Wallet`,
          },
        });
        return updatedPlayer;
      });
    }).catch((err) => {
      if (err.message === "not_found") return "not_found";
      if (err.message === "insufficient") return "insufficient";
      throw err;
    });

    if (updated === "not_found") {
      await bot.sendMessage(
        chatId,
        "Please register first using /start and share your phone number.",
      );
      userState.delete(tid);
      return;
    }
    if (updated === "insufficient") {
      await bot.sendMessage(chatId, "Insufficient coin to convert.");
      return;
    }

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

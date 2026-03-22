// Withdraw handler — port of bingo/withdraw.py
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const { notifyEntertainers, getEntertainerIds } = require("./entertainer");
const prisma = new PrismaClient();

const MIN_WITHDRAW = new Decimal(100);
const METHODS = [
  { key: "telebirr", label: "Telebirr / ቴሌብር" },
  { key: "cbe_birr", label: "CBE Birr / ሲቢኢ ብር" },
  { key: "boa", label: "BOA / ቢኦኤ" },
  { key: "cbe", label: "CBE / ሲቢኢ" },
];

function setupWithdraw(bot, userState) {
  // Helper to reset conversation state when starting withdraw
  function resetState(state) {
    // Clear deposit flow
    state.lastDepositMethod = null;
    state.depositAmount = null;
    state.awaitingDepositAmount = false;
    state.awaitingDepositReceipt = false;
    // Clear transfer flow
    state.transferStep = null;
    state.transfer = null;
    // Clear convert flow
    state.convertStep = null;
    state.convert = null;
    // Clear report flow
    state.reportStep = null;
    state.report = null;
  }

  bot.onText(/\/withdraw/, async (msg) => {
    const chatId = msg.chat.id;
    const tid = msg.from.id;

    if (!userState.has(tid)) userState.set(tid, {});
    const state = userState.get(tid);
    resetState(state); // Cancel any previous unfinished command
    state.withdrawStep = "amount";
    state.withdraw = {};

    await bot.sendMessage(
      chatId,
      "Please enter the amount you wish to withdraw in ETB.\n" +
        "እባክዎ ማውጣት የሚፈልጉትን የገንዘብ መጠን በብር ያስገቡ።\n\n" +
        `Minimum withdraw amount is ${MIN_WITHDRAW.toFixed(0)} ETB.\n` +
        `የማውጣት ከፍተኛ መጠን ${MIN_WITHDRAW.toFixed(0)} ብር ነው።\n\n` +
        "Type 'Cancel' to stop. / ለመመለስ 'Cancel' ብለው ይፃፉ።",
      {
        reply_markup: { remove_keyboard: true },
      },
    );
  });

  bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;
    const chatId = msg.chat.id;
    const tid = msg.from.id;
    const state = userState.get(tid);
    if (!state || !state.withdrawStep) return;

    const text = msg.text.trim();
    if (text.toLowerCase() === "cancel" || text === "Cancel / ሰርዝ" || text === "ሰርዝ") {
      userState.delete(tid);
      await bot.sendMessage(chatId, "Withdraw cancelled.");
      return;
    }

    if (state.withdrawStep === "amount") {
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
      if (amount.lt(MIN_WITHDRAW)) {
        await bot.sendMessage(
          chatId,
          `Withdraw amount must be greater than or equal to ${MIN_WITHDRAW.toFixed(0)}`,
        );
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

      const mainBalance = new Decimal(player.wallet.toString());
      const playBalance = new Decimal(player.gift.toString());
      if (mainBalance.lt(amount)) {
        let message = `❌ Withdrawal Failed — ማውጣት አልተቻለም ❌\n\n`;
        message += `Your main wallet balance: ${mainBalance.toFixed(2)} ETB\n`;
        message += `የዋና ቦርሳዎ ቀሪ ሂሳብ: ${mainBalance.toFixed(2)} ብር\n\n`;
        message += `Requested amount: ${amount.toFixed(2)} ETB\n`;
        message += `የጠየቁት መጠን: ${amount.toFixed(2)} ብር\n\n`;
        message += `⚠️ Your main wallet is less than you asked.\n`;
        message += `⚠️ የዋና ቦርሳዎ ከጠየቁት ያነሰ ነው።\n\n`;
        if (playBalance.gt(0)) {
          message += `ℹ️ Play wallet balance: ${playBalance.toFixed(2)} ETB\n`;
          message += `ℹ️ የጨዋታ ቦርሳ ቀሪ ሂሳብ: ${playBalance.toFixed(2)} ብር\n\n`;
          message += `Note: Play wallet can only be used for playing, not for withdrawal.\n`;
          message += `ማሳሰቢያ: የጨዋታ ቦርሳ ለመጫወት ብቻ ነው የሚሆነው፣ ለማውጣት አይቻልም።`;
        }
        await bot.sendMessage(chatId, message);
        userState.delete(tid);
        return;
      }

      state.withdraw = { amount, balance: mainBalance, phone: player.phone || "-" };
      state.withdrawStep = "method";

      await bot.sendMessage(chatId, "Please choose your withdraw method:", {
        reply_markup: {
          keyboard: [
            METHODS.map((m) => ({ text: m.label })),
            [{ text: "Cancel / ሰርዝ" }],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
          input_field_placeholder: "Choose withdraw method",
        },
      });
      return;
    }

    if (state.withdrawStep === "method") {
      const norm = text.toLowerCase();
      const matched = METHODS.find(
        (m) => m.key === norm || m.label.toLowerCase() === norm || m.label === text || m.label.split(" / ")[0].toLowerCase() === norm,
      );
      if (!matched) {
        await bot.sendMessage(
          chatId,
          "Please choose a valid method: Telebirr, CBE Birr, BOA, or CBE.",
        );
        return;
      }
      state.withdraw.method = matched.key;
      state.withdraw.methodLabel = matched.label;
      state.withdrawStep = "account";
      await bot.sendMessage(
        chatId,
        `Enter your ${matched.label} account/phone to receive the withdrawal:`,
        {
          reply_markup: { remove_keyboard: true },
        },
      );
      return;
    }

    if (state.withdrawStep === "account") {
      const account = text;
      const info = state.withdraw || {};
      const amount = info.amount;
      const balance = info.balance;
      const phone = info.phone || "-";
      const methodLabel = info.methodLabel || "-";
      const method = info.method || "";

      userState.delete(tid);

      if (!amount || !balance) {
        await bot.sendMessage(
          chatId,
          "Unable to process your request right now.",
        );
        return;
      }

      const username = msg.from.username || "-";

      let withdrawRequestId = null;
      try {
        const player = await prisma.player.findUnique({
          where: { telegramId: BigInt(tid) },
        });
        if (player) {
          const walletDec = new Decimal(player.wallet.toString());
          if (walletDec.lt(amount)) {
            await bot.sendMessage(chatId, "❌ Insufficient balance.");
            return;
          }

          // Hold pattern: deduct immediately, refund on reject
          const result = await prisma.$transaction(async (tx) => {
            await tx.player.update({
              where: { id: player.id },
              data: { wallet: { decrement: amount.toNumber() } },
            });
            await tx.transaction.create({
              data: {
                playerId: player.id,
                kind: "withdraw_hold",
                amount: amount.negated().toNumber(),
                note: "Withdraw request hold (pending admin approval)",
              },
            });
            return tx.withdrawRequest.create({
              data: {
                playerId: player.id,
                telegramId: BigInt(tid),
                amount: amount.toNumber(),
                method,
                account,
                status: "pending",
              },
            });
          });
          withdrawRequestId = result.id;
        }
      } catch (err) {
        console.error("withdraw request persist error:", err);
      }

      const entertainerIds = getEntertainerIds();
      if (entertainerIds.length > 0 && withdrawRequestId) {
        const message =
          `🏧 Withdrawal Request #${withdrawRequestId}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `User: @${username} (id: ${tid})\n` +
          `Phone: ${phone}\n` +
          `Amount: ${amount.toFixed(2)} ETB\n` +
          `Method: ${methodLabel}\n` +
          `Account: ${account}\n` +
          `Current Balance: ${balance.toFixed(2)} ETB\n`;

        await notifyEntertainers(bot, message, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Approve",
                  callback_data: `approve_withdraw:${withdrawRequestId}`,
                },
                {
                  text: "❌ Reject",
                  callback_data: `reject_withdraw:${withdrawRequestId}`,
                },
              ],
            ],
          },
        });
      }

      await bot.sendMessage(
        chatId,
        "Your withdrawal request has been received and is being processed by admin.\n" +
          `Requested Amount: ${amount.toFixed(2)} ETB\n` +
          `Method: ${methodLabel}\n` +
          `Account: ${account}\n` +
          `Current Balance: ${balance.toFixed(2)} ETB`,
      );
    }
  });
}

module.exports = { setupWithdraw };

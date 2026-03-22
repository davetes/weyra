// Transfer handler — port of bingo/transfer.py
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const prisma = new PrismaClient();

const MIN_TRANSFER = new Decimal(20);
const MAX_TRANSFER = new Decimal(500);

function normalizePhone(p) {
  return (p || "").replace(/[\s\-_]/g, "");
}

function altFormats(p) {
  const out = new Set([p]);
  if (p.startsWith("0")) out.add(`+251${p.slice(1)}`);
  if (p.startsWith("+251")) out.add(`0${p.slice(4)}`);
  return [...out];
}

function setupTransfer(bot, userState) {
  // Helper to reset conversation state when starting transfer
  function resetState(state) {
    // Clear deposit flow
    state.lastDepositMethod = null;
    state.depositAmount = null;
    state.awaitingDepositAmount = false;
    state.awaitingDepositReceipt = false;
    // Clear withdraw flow
    state.withdrawStep = null;
    state.withdraw = null;
    // Clear convert flow
    state.convertStep = null;
    state.convert = null;
    // Clear report flow
    state.reportStep = null;
    state.report = null;
  }

  bot.onText(/\/transfer/, async (msg) => {
    const chatId = msg.chat.id;
    const tid = msg.from.id;

    if (!userState.has(tid)) userState.set(tid, {});
    const state = userState.get(tid);
    resetState(state); // Cancel any previous unfinished command
    state.transferStep = "phone";
    state.transfer = {};

    await bot.sendMessage(
      chatId,
      "Enter the phone number of the person you want to transfer money to 📞:",
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
    if (!state || !state.transferStep) return;

    const text = msg.text.trim();
    if (text.toLowerCase() === "cancel" || text === "Cancel / ሰርዝ" || text === "ሰርዝ") {
      userState.delete(tid);
      await bot.sendMessage(chatId, "Transfer cancelled.");
      return;
    }

    if (state.transferStep === "phone") {
      const phone = normalizePhone(text);
      if (!phone.match(/^[+]?\d{9,13}$/)) {
        await bot.sendMessage(chatId, "Please enter a valid phone number :");
        return;
      }

      const formats = altFormats(phone);
      const recipient = await prisma.player.findFirst({
        where: { phone: { in: formats } },
      });
      if (!recipient) {
        await bot.sendMessage(
          chatId,
          "No registered user found with that phone number.",
        );
        return;
      }
      if (recipient.telegramId === BigInt(tid)) {
        await bot.sendMessage(
          chatId,
          "You cannot transfer to yourself. Please enter a different phone number:",
        );
        return;
      }

      state.transfer = {
        recipientTid: recipient.telegramId,
        recipientPhone: recipient.phone,
      };
      state.transferStep = "amount";
      await bot.sendMessage(
        chatId,
        "Here are the min and max amount you can transfer\n" +
          `Min Amount:       ${MIN_TRANSFER.toFixed(0)} ETB \n` +
          `Max Amount:      ${MAX_TRANSFER.toFixed(0)} ETB`,
      );
      await bot.sendMessage(chatId, "Please enter the amount:");
      return;
    }

    if (state.transferStep === "amount") {
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
      if (amount.lt(MIN_TRANSFER) || amount.gt(MAX_TRANSFER)) {
        await bot.sendMessage(
          chatId,
          "Here are the min and max amount you can transfer\n" +
            `Min Amount:       ${MIN_TRANSFER.toFixed(0)} ETB \n` +
            `Max Amount:      ${MAX_TRANSFER.toFixed(0)} ETB`,
        );
        await bot.sendMessage(chatId, "Please enter the amount:");
        return;
      }

      const info = state.transfer || {};
      const recipientTid = info.recipientTid;
      if (!recipientTid) {
        await bot.sendMessage(
          chatId,
          "Session expired. Please run /transfer again.",
        );
        userState.delete(tid);
        return;
      }
      if (recipientTid === BigInt(tid)) {
        await bot.sendMessage(chatId, "You cannot transfer to yourself.");
        userState.delete(tid);
        return;
      }

      // Use transaction to prevent TOCTOU race on balance
      const result = await prisma.$transaction(async (tx) => {
        const sender = await tx.player.findUnique({
          where: { telegramId: BigInt(tid) },
        });
        const recipient = await tx.player.findUnique({
          where: { telegramId: recipientTid },
        });
        if (!sender || !recipient) {
          throw new Error("not_registered");
        }

        const sbal = new Decimal(sender.wallet.toString());
        if (sbal.lt(amount)) {
          throw new Error("insufficient");
        }

        const newSenderBal = sbal.minus(amount);
        const newRecipientBal = new Decimal(recipient.wallet.toString()).plus(
          amount,
        );
        await tx.player.update({
          where: { id: sender.id },
          data: { wallet: newSenderBal.toNumber() },
        });
        await tx.player.update({
          where: { id: recipient.id },
          data: { wallet: newRecipientBal.toNumber() },
        });

        // Log transaction for sender (debit)
        await tx.transaction.create({
          data: {
            playerId: sender.id,
            kind: "transfer_out",
            amount: amount.negated().toNumber(),
            note: `Transfer to ${recipient.username || recipient.phone || String(recipient.telegramId)}`,
          },
        });

        // Log transaction for recipient (credit)
        await tx.transaction.create({
          data: {
            playerId: recipient.id,
            kind: "transfer_in",
            amount: amount.toNumber(),
            note: `Transfer from ${sender.username || sender.phone || String(sender.telegramId)}`,
          },
        });

        return { newSenderBal, recipient };
      }).catch((err) => {
        if (err.message === "not_registered") return "not_registered";
        if (err.message === "insufficient") return "insufficient";
        throw err;
      });

      if (result === "not_registered") {
        await bot.sendMessage(
          chatId,
          "Please register first using /start and share your phone number.",
        );
        return;
      }
      if (result === "insufficient") {
        await bot.sendMessage(
          chatId,
          "You don't have a sufficient amount to withdraw. Please try again.",
        );
        userState.delete(tid);
        return;
      }

      userState.delete(tid);

      await bot.sendMessage(
        chatId,
        "Transfer successful.\n" +
          `Sent: ${amount.toFixed(2)} ETB\n` +
          `To: ${result.recipient.username || "-"} (${info.recipientPhone || "-"})\n` +
          `New Balance: ${result.newSenderBal.toFixed(2)} ETB`,
      );

      try {
        const newRecipientBal = new Decimal(result.recipient.wallet.toString()).plus(amount);
        await bot.sendMessage(
          Number(result.recipient.telegramId),
          "You have received a transfer.\n" +
            `Amount: +${amount.toFixed(2)} ETB\n` +
            `New Balance: ${newRecipientBal.toFixed(2)} ETB`,
        );
      } catch (_) {}
    }
  });
}

module.exports = { setupTransfer };

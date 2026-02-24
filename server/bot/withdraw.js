// Withdraw handler — port of bingo/withdraw.py
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const prisma = new PrismaClient();

const MIN_WITHDRAW = new Decimal(100);
const METHODS = [
  { key: "telebirr", label: "Telebirr" },
  { key: "cbe_birr", label: "CBE Birr" },
  { key: "boa", label: "BOA" },
  { key: "cbe", label: "CBE" },
];

function setupWithdraw(bot, userState) {
  bot.onText(/\/withdraw/, async (msg) => {
    const chatId = msg.chat.id;
    const tid = msg.from.id;

    if (!userState.has(tid)) userState.set(tid, {});
    const state = userState.get(tid);
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
    if (text.toLowerCase() === "cancel") {
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

      const balance = new Decimal(player.wallet.toString());
      if (balance.lt(amount)) {
        await bot.sendMessage(
          chatId,
          `     ❌ Withdrawal Failed — ማውጣት አልተቻለም ❌
                ምክንያት፦ በወይራ ቦርሳዎ ውስጥ በቂ ቀሪ ሂሳብ የለም። 
                `,
        );
        return;
      }

      state.withdraw = { amount, balance, phone: player.phone || "-" };
      state.withdrawStep = "method";

      await bot.sendMessage(chatId, "Please choose your withdraw method:", {
        reply_markup: {
          keyboard: [
            METHODS.map((m) => ({ text: m.label })),
            [{ text: "Cancel" }],
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
        (m) => m.key === norm || m.label.toLowerCase() === norm,
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

      const entertainerId =
        parseInt(process.env.ENTERTAINER_ID || "0", 10) || null;
      const username = msg.from.username || "-";

      try {
        const player = await prisma.player.findUnique({
          where: { telegramId: BigInt(tid) },
        });
        if (player) {
          await prisma.withdrawRequest.create({
            data: {
              playerId: player.id,
              telegramId: BigInt(tid),
              amount: amount.toNumber(),
              method,
              account,
              status: "pending",
            },
          });
        }
      } catch (err) {
        console.error("withdraw request persist error:", err);
      }

      if (entertainerId) {
        try {
          await bot.sendMessage(
            entertainerId,
            "Withdrawal Request\n" +
              `User: @${username} (id: ${tid})\n` +
              `Phone: ${phone}\n` +
              `Amount: ${amount.toFixed(2)} ETB\n` +
              `Method: ${methodLabel}\n` +
              `Account: ${account}\n` +
              `Current Balance: ${balance.toFixed(2)} ETB\n`,
          );
        } catch (_) {}
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

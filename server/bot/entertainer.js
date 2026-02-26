// Entertainer handler — port of bingo/entertainer.py
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const prisma = new PrismaClient();

// Support multiple entertainer IDs (comma-separated)
function getEntertainerIds() {
  const ids = process.env.ENTERTAINER_IDS || process.env.ENTERTAINER_ID || "";
  return ids.split(",").map(id => parseInt(id.trim(), 10)).filter(id => id > 0);
}

function isEntertainer(tid) {
  const entertainerIds = getEntertainerIds();
  return entertainerIds.includes(tid);
}

// Send message to all entertainers
async function notifyEntertainers(bot, message, options = {}) {
  const entertainerIds = getEntertainerIds();
  for (const entertainerId of entertainerIds) {
    try {
      await bot.sendMessage(entertainerId, message, options);
    } catch (err) {
      console.error(`Failed to notify entertainer ${entertainerId}:`, err.message);
    }
  }
}

// Forward message to all entertainers
async function forwardToEntertainers(bot, fromChatId, messageId) {
  const entertainerIds = getEntertainerIds();
  for (const entertainerId of entertainerIds) {
    try {
      await bot.forwardMessage(entertainerId, fromChatId, messageId);
    } catch (err) {
      console.error(`Failed to forward to entertainer ${entertainerId}:`, err.message);
    }
  }
}

async function resolvePlayer(identifier) {
  if (!identifier) return null;
  const ident = identifier.trim();
  if (ident.startsWith("@")) {
    const uname = ident.slice(1);
    return prisma.player.findFirst({
      where: { username: { equals: uname, mode: "insensitive" } },
    });
  }
  const tid = parseInt(ident, 10);
  if (!tid) return null;
  return prisma.player.findUnique({ where: { telegramId: BigInt(tid) } });
}

function setupEntertainer(bot) {
  bot.onText(/\/balances (.+)/, async (msg, match) => {
    const tid = msg.from.id;
    if (!isEntertainer(tid)) return;

    const player = await resolvePlayer(match[1]);
    if (!player) return bot.sendMessage(msg.chat.id, "Player not found");

    const wallet = new Decimal(player.wallet.toString());
    const gift = new Decimal(player.gift.toString());
    await bot.sendMessage(
      msg.chat.id,
      "```\n" +
        `Username:      ${player.username || "-"}\n` +
        `Telegram ID:   ${player.telegramId || "-"}\n` +
        `Wallet:        ${wallet.toFixed(2)} ETB\n` +
        `Play Wallet:   ${gift.toFixed(2)} ETB\n` +
        "```",
      { parse_mode: "Markdown" },
    );
  });

  bot.onText(/\/add (.+)/, async (msg, match) => {
    const tid = msg.from.id;
    if (!isEntertainer(tid)) return;

    const parts = match[1].trim().split(/\s+/);
    if (parts.length < 2)
      return bot.sendMessage(
        msg.chat.id,
        "Usage: /add <id|@username> <amount>",
      );

    const player = await resolvePlayer(parts[0]);
    if (!player) return bot.sendMessage(msg.chat.id, "Player not found");

    let amount;
    try {
      amount = new Decimal(parts[1]);
    } catch (_) {
      amount = null;
    }
    if (!amount) return bot.sendMessage(msg.chat.id, "Invalid amount");
    if (amount.isZero())
      return bot.sendMessage(msg.chat.id, "Amount must be non-zero");

    const before = new Decimal(player.wallet.toString());
    const after = before.plus(amount);
    await prisma.$transaction([
      prisma.player.update({
        where: { id: player.id },
        data: { wallet: after.toNumber() },
      }),
      prisma.transaction.create({
        data: {
          playerId: player.id,
          kind: "add",
          amount: amount.toNumber(),
          note: "/add via entertainer",
          actorTid: BigInt(tid),
        },
      }),
    ]);

    await bot.sendMessage(
      msg.chat.id,
      `Wallet updated: ${before.toFixed(2)} → ${after.toFixed(2)} ETB`,
    );
  });

  bot.onText(/\/subtract (.+)/, async (msg, match) => {
    const tid = msg.from.id;
    if (!isEntertainer(tid)) return;

    const parts = match[1].trim().split(/\s+/);
    if (parts.length < 2)
      return bot.sendMessage(
        msg.chat.id,
        "Usage: /subtract <id|@username> <amount>",
      );

    const player = await resolvePlayer(parts[0]);
    if (!player) return bot.sendMessage(msg.chat.id, "Player not found");

    let amount;
    try {
      amount = new Decimal(parts[1]);
    } catch (_) {
      amount = null;
    }
    if (!amount) return bot.sendMessage(msg.chat.id, "Invalid amount");
    if (amount.lte(0))
      return bot.sendMessage(msg.chat.id, "Amount must be greater than zero");

    const before = new Decimal(player.wallet.toString());
    const after = before.minus(amount);
    await prisma.$transaction([
      prisma.player.update({
        where: { id: player.id },
        data: { wallet: after.toNumber() },
      }),
      prisma.transaction.create({
        data: {
          playerId: player.id,
          kind: "add",
          amount: amount.negated().toNumber(),
          note: "/subtract via entertainer",
          actorTid: BigInt(tid),
        },
      }),
    ]);

    await bot.sendMessage(
      msg.chat.id,
      `Wallet updated: ${before.toFixed(2)} → ${after.toFixed(2)} ETB`,
    );
  });

  bot.onText(/\/roles/, async (msg) => {
    const tid = msg.from.id;
    if (!isEntertainer(tid)) return;

    const text =
      "🔥 Entertainer Commands\n\n" +
      "1) /balances <id|@username>\n" +
      "   • Show player's balances (Wallet ETB and Play Wallet).\n" +
      "   • Example: /balances 911608626\n" +
      "             /balances @username\n\n" +
      "2) /add <id|@username> <amount>\n" +
      "   • Add ETB amount to wallet.\n" +
      "   • Example: /add 911608626 50\n" +
      "             /add @username 25.75\n\n" +
      "3) /subtract <id|@username> <amount>\n" +
      "   • Subtract ETB amount from wallet.\n" +
      "   • Example: /subtract 911608626 10\n" +
      "             /subtract @username 5.50\n\n" +
      "4) /pending_withdraws\n" +
      "   • Show all pending withdrawal requests.\n\n" +
      "5) /pending_deposits\n" +
      "   • Show all pending deposit requests.\n\n";
    await bot.sendMessage(msg.chat.id, text);
  });

  // Show pending withdrawals
  bot.onText(/\/pending_withdraws/, async (msg) => {
    const tid = msg.from.id;
    if (!isEntertainer(tid)) return;

    const pendingWithdraws = await prisma.withdrawRequest.findMany({
      where: { status: "pending" },
      include: { player: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    if (pendingWithdraws.length === 0) {
      return bot.sendMessage(msg.chat.id, "No pending withdrawal requests.");
    }

    for (const req of pendingWithdraws) {
      const player = req.player;
      const balance = new Decimal(player.wallet.toString()).toFixed(2);
      const text =
        `🏧 Withdrawal Request #${req.id}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `User: @${player.username || "-"} (id: ${req.telegramId})\n` +
        `Phone: ${player.phone || "-"}\n` +
        `Amount: ${new Decimal(req.amount.toString()).toFixed(2)} ETB\n` +
        `Method: ${req.method}\n` +
        `Account: ${req.account}\n` +
        `Balance: ${balance} ETB\n` +
        `Created: ${req.createdAt.toISOString()}\n`;

      await bot.sendMessage(msg.chat.id, text, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `approve_withdraw:${req.id}` },
              { text: "❌ Reject", callback_data: `reject_withdraw:${req.id}` },
            ],
          ],
        },
      });
    }
  });

  // Show pending deposits
  bot.onText(/\/pending_deposits/, async (msg) => {
    const tid = msg.from.id;
    if (!isEntertainer(tid)) return;

    const pendingDeposits = await prisma.depositRequest.findMany({
      where: { status: "pending" },
      include: { player: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    if (pendingDeposits.length === 0) {
      return bot.sendMessage(msg.chat.id, "No pending deposit requests.");
    }

    for (const req of pendingDeposits) {
      const player = req.player;
      const amount = req.amount ? new Decimal(req.amount.toString()).toFixed(2) : "N/A";
      const text =
        `💰 Deposit Request #${req.id}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `User: @${player.username || "-"} (id: ${req.telegramId})\n` +
        `Phone: ${player.phone || "-"}\n` +
        `Amount: ${amount} ETB\n` +
        `Method: ${req.method || "-"}\n` +
        `Caption: ${req.caption || "-"}\n` +
        `Created: ${req.createdAt.toISOString()}\n`;

      await bot.sendMessage(msg.chat.id, text, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `approve_deposit:${req.id}` },
              { text: "❌ Reject", callback_data: `reject_deposit:${req.id}` },
            ],
          ],
        },
      });
    }
  });

  // Handle approve/reject callbacks
  bot.on("callback_query", async (query) => {
    const tid = query.from.id;
    if (!isEntertainer(tid)) return;

    const data = query.data || "";
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;

    // Approve Withdraw
    if (data.startsWith("approve_withdraw:")) {
      const reqId = parseInt(data.split(":")[1], 10);
      await bot.answerCallbackQuery(query.id, { text: "Processing..." });

      const req = await prisma.withdrawRequest.findUnique({
        where: { id: reqId },
        include: { player: true },
      });

      if (!req) {
        return bot.sendMessage(chatId, "Withdrawal request not found.");
      }
      if (req.status !== "pending") {
        return bot.sendMessage(chatId, `Request already ${req.status}.`);
      }

      const player = req.player;
      const amount = new Decimal(req.amount.toString());
      const balance = new Decimal(player.wallet.toString());

      if (balance.lt(amount)) {
        return bot.sendMessage(chatId, `❌ Insufficient balance. Player has ${balance.toFixed(2)} ETB, needs ${amount.toFixed(2)} ETB.`);
      }

      // Deduct from wallet and mark as approved
      await prisma.$transaction([
        prisma.player.update({
          where: { id: player.id },
          data: { wallet: { decrement: amount.toNumber() } },
        }),
        prisma.transaction.create({
          data: {
            playerId: player.id,
            kind: "withdraw",
            amount: amount.negated().toNumber(),
            note: `Withdraw approved #${reqId} via ${req.method}`,
            actorTid: BigInt(tid),
          },
        }),
        prisma.withdrawRequest.update({
          where: { id: reqId },
          data: { status: "approved", decidedAt: new Date() },
        }),
      ]);

      // Update the message to show approved
      try {
        await bot.editMessageText(
          query.message.text + `\n\n✅ APPROVED by ${query.from.username || tid}`,
          { chat_id: chatId, message_id: messageId }
        );
      } catch (_) {}

      // Notify player
      try {
        await bot.sendMessage(
          req.telegramId.toString(),
          `✅ Your withdrawal of ${amount.toFixed(2)} ETB has been approved!\n` +
          `Method: ${req.method}\n` +
          `Account: ${req.account}\n` +
          `The amount will be sent shortly.`
        );
      } catch (_) {}

      return;
    }

    // Reject Withdraw
    if (data.startsWith("reject_withdraw:")) {
      const reqId = parseInt(data.split(":")[1], 10);
      await bot.answerCallbackQuery(query.id, { text: "Processing..." });

      const req = await prisma.withdrawRequest.findUnique({
        where: { id: reqId },
        include: { player: true },
      });

      if (!req) {
        return bot.sendMessage(chatId, "Withdrawal request not found.");
      }
      if (req.status !== "pending") {
        return bot.sendMessage(chatId, `Request already ${req.status}.`);
      }

      await prisma.withdrawRequest.update({
        where: { id: reqId },
        data: { status: "rejected", decidedAt: new Date() },
      });

      // Update the message to show rejected
      try {
        await bot.editMessageText(
          query.message.text + `\n\n❌ REJECTED by ${query.from.username || tid}`,
          { chat_id: chatId, message_id: messageId }
        );
      } catch (_) {}

      // Notify player
      try {
        await bot.sendMessage(
          req.telegramId.toString(),
          `❌ Your withdrawal request of ${new Decimal(req.amount.toString()).toFixed(2)} ETB has been rejected.\n` +
          `Please contact support for more information.`
        );
      } catch (_) {}

      return;
    }

    // Approve Deposit
    if (data.startsWith("approve_deposit:")) {
      const reqId = parseInt(data.split(":")[1], 10);
      await bot.answerCallbackQuery(query.id, { text: "Processing..." });

      const req = await prisma.depositRequest.findUnique({
        where: { id: reqId },
        include: { player: true },
      });

      if (!req) {
        return bot.sendMessage(chatId, "Deposit request not found.");
      }
      if (req.status !== "pending") {
        return bot.sendMessage(chatId, `Request already ${req.status}.`);
      }
      if (!req.amount) {
        return bot.sendMessage(chatId, "❌ No amount specified for this deposit request.");
      }

      const player = req.player;
      const amount = new Decimal(req.amount.toString());

      // Add to wallet and mark as approved
      await prisma.$transaction([
        prisma.player.update({
          where: { id: player.id },
          data: { wallet: { increment: amount.toNumber() } },
        }),
        prisma.transaction.create({
          data: {
            playerId: player.id,
            kind: "deposit",
            amount: amount.toNumber(),
            note: `Deposit approved #${reqId} via ${req.method || "unknown"}`,
            actorTid: BigInt(tid),
          },
        }),
        prisma.depositRequest.update({
          where: { id: reqId },
          data: { status: "approved", decidedAt: new Date() },
        }),
      ]);

      // Update the message to show approved
      try {
        await bot.editMessageText(
          query.message.text + `\n\n✅ APPROVED by ${query.from.username || tid}`,
          { chat_id: chatId, message_id: messageId }
        );
      } catch (_) {}

      // Notify player
      try {
        await bot.sendMessage(
          req.telegramId.toString(),
          `✅ Your deposit of ${amount.toFixed(2)} ETB has been approved!\n` +
          `The amount has been added to your wallet.`
        );
      } catch (_) {}

      return;
    }

    // Reject Deposit
    if (data.startsWith("reject_deposit:")) {
      const reqId = parseInt(data.split(":")[1], 10);
      await bot.answerCallbackQuery(query.id, { text: "Processing..." });

      const req = await prisma.depositRequest.findUnique({
        where: { id: reqId },
        include: { player: true },
      });

      if (!req) {
        return bot.sendMessage(chatId, "Deposit request not found.");
      }
      if (req.status !== "pending") {
        return bot.sendMessage(chatId, `Request already ${req.status}.`);
      }

      await prisma.depositRequest.update({
        where: { id: reqId },
        data: { status: "rejected", decidedAt: new Date() },
      });

      // Update the message to show rejected
      try {
        await bot.editMessageText(
          query.message.text + `\n\n❌ REJECTED by ${query.from.username || tid}`,
          { chat_id: chatId, message_id: messageId }
        );
      } catch (_) {}

      // Notify player
      try {
        await bot.sendMessage(
          req.telegramId.toString(),
          `❌ Your deposit request has been rejected.\n` +
          `Please contact support if you believe this is an error.`
        );
      } catch (_) {}

      return;
    }
  });
}

module.exports = { setupEntertainer, isEntertainer, notifyEntertainers, forwardToEntertainers, getEntertainerIds };

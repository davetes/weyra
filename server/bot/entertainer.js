// Entertainer handler — port of bingo/entertainer.py
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const prisma = new PrismaClient();

function isEntertainer(tid) {
  const entertainerId = parseInt(process.env.ENTERTAINER_ID || "0", 10);
  return tid === entertainerId;
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
      "             /subtract @username 5.50\n\n";
    await bot.sendMessage(msg.chat.id, text);
  });
}

module.exports = { setupEntertainer };

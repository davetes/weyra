// Invite handler — port of bingo/invite.py

function setupInvite(bot) {
  bot.onText(/\/invite/, async (msg) => {
    const tid = msg.from.id;
    const chatId = msg.chat.id;
    const botInfo = await bot.getMe();
    const link = `https://t.me/${botInfo.username}?start=ref_${tid}`;

    await bot.sendMessage(
      chatId,
      `🎁 *Invite Friends*\n\n` +
        `Share your referral link:\n` +
        `\`${link}\`\n\n` +
        `You'll receive *3 ETB* for each new player who joins using your link!`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📤 Share Link",
                switch_inline_query: `Join weyra Bingo! ${link}`,
              },
            ],
          ],
        },
      },
    );
  });
}

module.exports = { setupInvite };

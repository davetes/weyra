// Deposit handler — port of bingo/deposit.py

function buildDepositKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Telebirr", callback_data: "deposit_telebirr" },
        { text: "BOA (Abyssinia)", callback_data: "deposit_boa" },
      ],
      [
        { text: "CBE Birr", callback_data: "deposit_cbe_birr" },
        { text: "CBE", callback_data: "deposit_cbe" },
      ],
    ],
  };
}

function buildDepositMessage(data) {
  const support = process.env.SUPPORT_HANDLE || "supprort username";

  if (data === "deposit_cbe") {
    const acc = process.env.CBE_ACCOUNT || "1000 0000 0000";
    const name = process.env.CBE_ACCOUNT_NAME || "weyra bingo";
    return (
      `<b>ለ CBE ሒሳብ</b>\n` +
      `<code>${acc}</code> - <b>${name}</b>\n\n` +
      `<b>መመሪያ</b>\n` +
      `<pre>1. ከባንክ ወይም በ CBE ስልክ መተግበሪያ ገንዘብ ይላኩ\n` +
      `2. በክፍያ ከጨረሱ በኋላ የተላኩትን የክፍያ ማስረጃ (sms) ወይም ስክሪንሹት ይላኩ\n` +
      `3. ደረሰኝ መልዕክት (sms) ጽሁፉን በኩፒ (copy) አድርገው እዚህ በፔስት (paste) ያስገቡ</pre>\n\n` +
      `ማረጋገጫውን ወደ ድጋፍ ቡድኑ እና ${support} ወይም እዚህ ያስቀምጡ.`
    );
  }

  if (data === "deposit_boa") {
    const acc = process.env.BOA_ACCOUNT || "2000 0000 0000";
    const name = process.env.BOA_ACCOUNT_NAME || "weyra Bingo";
    return (
      `<b>ለ BOA ሒሳብ</b>\n` +
      `<code>${acc}</code> - <b>${name}</b>\n\n` +
      `<b>መመሪያ</b>\n` +
      `<pre>1. ከባንክ ወይም በ BOA መተግበሪያ ገንዘብ ይላኩ\n` +
      `2. በክፍያ ከጨረሱ በኋላ የተላኩትን የክፍያ ማስረጃ (sms) ወይም ስክሪንሹት ይላኩ\n` +
      `3. ደረሰኝ መልዕክት (sms) ጽሁፉን በኩፒ (copy) አድርገው እዚህ በፔስት (paste) ያስገቡ</pre>\n\n` +
      `ማረጋገጫውን ወደ ድጋፍ ቡድኑ እና ${support} ወይም እዚህ ያስቀምጡ.`
    );
  }

  if (data === "deposit_cbe_birr") {
    const phone = process.env.CBE_BIRR_PHONE || "+251900000000";
    const name = process.env.CBE_BIRR_NAME || "weyra Bingo";
    return (
      `<b>ለ CBE-Birr ሒሳብ</b>\n` +
      `<code>${phone}</code> - <b>${name}</b>\n\n` +
      `<b>መመሪያ</b>\n` +
      `<pre>1. ከሚስጥር ቁጥር ወይም በ CBE-Birr መተግበሪያ ገንዘብ ይላኩ\n` +
      `2. በክፍያ ከጨረሱ በኋላ የተላኩትን የክፍያ ማስረጃ (sms) ወይም ስክሪንሹት ይላኩ\n` +
      `3. ደረሰኝ መልዕክት (sms) ጽሁፉን በኩፒ (copy) አድርገው እዚህ በፔስት (paste) ያስገቡ</pre>\n\n` +
      `ማረጋገጫውን ወደ ድጋፍ ቡድኑ እና ${support} ወይም እዚህ ያስቀምጡ.`
    );
  }

  if (data === "deposit_telebirr") {
    const phone = process.env.TELEBIRR_PHONE || "+251900000000";
    const name = process.env.TELEBIRR_NAME || "weyra Bingo";
    return (
      `<b>ለ Telebirr ሒሳብ</b>\n` +
      `<code>${phone}</code> - <b>${name}</b>\n\n` +
      `<b>መመሪያ</b>\n` +
      `<pre>1. ከባንክ ወይም በ Telebirr መተግበሪያ ገንዘብ ይላኩ\n` +
      `2. በክፍያ ከጨረሱ በኋላ የተላኩትን የክፍያ ማስረጃ (sms) ወይም ስክሪንሹት ይላኩ\n` +
      `3. ደረሰኝ መልዕክት (sms) ጽሁፉን በኩፒ (copy) አድርገው እዚህ በፔስት (paste) ያስገቡ</pre>\n\n` +
      `ማረጋገጫውን ወደ ድጋፍ ቡድኑ እና ${support} ወይም እዚህ ያስቀምጡ.`
    );
  }

  return null;
}

async function handleDepositSelection(bot, chatId, data) {
  const text = buildDepositMessage(data);
  if (!text) {
    await bot.sendMessage(
      chatId,
      "Please select a bank option for the top-up.",
    );
    return;
  }
  await bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

function setupDeposit(bot) {
  bot.onText(/\/deposit/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(
      chatId,
      "Please select the bank option you wish to use for the top-up.",
      {
        reply_markup: buildDepositKeyboard(),
      },
    );
  });
}

module.exports = { setupDeposit, buildDepositKeyboard, handleDepositSelection };

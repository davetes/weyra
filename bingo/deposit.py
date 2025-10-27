import os
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes


def build_deposit_keyboard() -> InlineKeyboardMarkup:
    rows = [
        [   InlineKeyboardButton("Telebirr", callback_data="deposit_telebirr"),
            InlineKeyboardButton("BOA (Abyssinia)", callback_data="deposit_boa"),
        ],
        [
            InlineKeyboardButton("CBE Birr", callback_data="deposit_cbe_birr"),
            InlineKeyboardButton("CBE", callback_data="deposit_cbe"),
        ],
    ]
    return InlineKeyboardMarkup(rows)


async def handle_deposit_selection(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    data = (query.data or "").lower()

    if data == "deposit_cbe":
        acc = os.getenv("CBE_ACCOUNT", "1000 0000 0000")
        name = os.getenv("CBE_ACCOUNT_NAME", "LuckyBet Bingo")
        support = os.getenv("SUPPORT_HANDLE", "@Rohabingosupport")
        # Styled similar to the screenshot: title, account line, and Amharic instructions
        text = (
            f"<b>ለ CBE ሒሳብ</b>\n"
            f"<code>{acc}</code> - <b>{name}</b>\n\n"
            "<b>መመሪያ</b>\n"
            "<pre>1. ከባንክ ወይም በ CBE ስልክ መተግበሪያ ገንዘብ ይላኩ\n"
            "2. በክፍያ ከጨረሱ በኋላ የተላኩትን የክፍያ ማስረጃ (sms) ወይም ስክሪንሹት ይላኩ\n"
            "3. ደረሰኝ መልዕክት (sms) ጽሁፉን በኩፒ (copy) አድርገው እዚህ በፔስት (paste) ያስገቡ</pre>\n\n"
            f"ማረጋገጫውን ወደ ድጋፍ ቡድኑ እና {support} ወይም እዚህ ያስቀምጡ."
        )
        await query.message.reply_text(text, parse_mode="HTML", disable_web_page_preview=True)
        return

    if data == "deposit_boa":
        acc = os.getenv("BOA_ACCOUNT", "2000 0000 0000")
        name = os.getenv("BOA_ACCOUNT_NAME", "LuckyBet Bingo")
        support = os.getenv("SUPPORT_HANDLE", "@Rohabingosupport")
        text = (
            f"<b>ለ BOA ሒሳብ</b>\n"
            f"<code>{acc}</code> - <b>{name}</b>\n\n"
            "<b>መመሪያ</b>\n"
            "<pre>1. ከባንክ ወይም በ BOA መተግበሪያ ገንዘብ ይላኩ\n"
            "2. በክፍያ ከጨረሱ በኋላ የተላኩትን የክፍያ ማስረጃ (sms) ወይም ስክሪንሹት ይላኩ\n"
            "3. ደረሰኝ መልዕክት (sms) ጽሁፉን በኩፒ (copy) አድርገው እዚህ በፔስት (paste) ያስገቡ</pre>\n\n"
            f"ማረጋገጫውን ወደ ድጋፍ ቡድኑ እና {support} ወይም እዚህ ያስቀምጡ."
        )
        await query.message.reply_text(text, parse_mode="HTML", disable_web_page_preview=True)
        return

    if data == "deposit_cbe_birr":
        phone = os.getenv("CBE_BIRR_PHONE", "+251900000000")
        name = os.getenv("CBE_BIRR_NAME", "LuckyBet Bingo")
        support = os.getenv("SUPPORT_HANDLE", "@Rohabingosupport")
        text = (
            f"<b>ለ CBE-Birr ሒሳብ</b>\n"
            f"<code>{phone}</code> - <b>{name}</b>\n\n"
            "<b>መመሪያ</b>\n"
            "<pre>1. ከሚስጥር ቁጥር ወይም በ CBE-Birr መተግበሪያ ገንዘብ ይላኩ\n"
            "2. በክፍያ ከጨረሱ በኋላ የተላኩትን የክፍያ ማስረጃ (sms) ወይም ስክሪንሹት ይላኩ\n"
            "3. ደረሰኝ መልዕክት (sms) ጽሁፉን በኩፒ (copy) አድርገው እዚህ በፔስት (paste) ያስገቡ</pre>\n\n"
            f"ማረጋገጫውን ወደ ድጋፍ ቡድኑ እና {support} ወይም እዚህ ያስቀምጡ."
        )
        await query.message.reply_text(text, parse_mode="HTML", disable_web_page_preview=True)
        return

    if data == "deposit_telebirr":
        phone = os.getenv("TELEBIRR_PHONE", "+251900000000")
        name = os.getenv("TELEBIRR_NAME", "LuckyBet Bingo")
        support = os.getenv("SUPPORT_HANDLE", "@Rohabingosupport")
        text = (
            f"<b>ለ Telebirr ሒሳብ</b>\n"
            f"<code>{phone}</code> - <b>{name}</b>\n\n"
            "<b>መመሪያ</b>\n"
            "<pre>1. ከባንክ ወይም በ Telebirr መተግበሪያ ገንዘብ ይላኩ\n"
            "2. በክፍያ ከጨረሱ በኋላ የተላኩትን የክፍያ ማስረጃ (sms) ወይም ስክሪንሹት ይላኩ\n"
            "3. ደረሰኝ መልዕክት (sms) ጽሁፉን በኩፒ (copy) አድርገው እዚህ በፔስት (paste) ያስገቡ</pre>\n\n"
            f"ማረጋገጫውን ወደ ድጋፍ ቡድኑ እና {support} ወይም እዚህ ያስቀምጡ."
        )
        await query.message.reply_text(text, parse_mode="HTML", disable_web_page_preview=True)
        return

    await query.message.reply_text("Please select a bank option for the top-up.")

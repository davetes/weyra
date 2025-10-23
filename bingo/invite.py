import os
import urllib.parse
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.ext import ContextTypes

from asgiref.sync import sync_to_async
from .models import Player


async def _get_bot_username(context: ContextTypes.DEFAULT_TYPE) -> str | None:
    cached = context.application.bot_data.get("bot_username") if context and context.application else None
    if cached:
        return cached
    try:
        me = await context.bot.get_me()
        if me and me.username:
            context.application.bot_data["bot_username"] = me.username
            return me.username
    except Exception:
        pass
    # Fallback to env if provided
    return os.getenv("BOT_USERNAME")


def _ref_code(user_id: int) -> str:
    return f"ref_{user_id}"


async def handle_invite(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    chat_id = update.effective_chat.id if update.effective_chat else None
    if not chat_id:
        return

    username = (user.username if user else None) or "there"

    # Ensure player exists (optional, best-effort)
    if user:
        def upsert():
            obj, _ = Player.objects.get_or_create(telegram_id=user.id)
            if not obj.username:
                obj.username = user.username or ""
            obj.save(update_fields=["username"]) if obj.pk else None
        try:
            await sync_to_async(upsert)()
        except Exception:
            pass

    bot_username = await _get_bot_username(context)
    if bot_username and user:
        deep_link = f"https://t.me/{bot_username}?start={_ref_code(user.id)}"
    else:
        base = os.getenv("WEBAPP_URL", "http://127.0.0.1:8000").rstrip("/")
        deep_link = f"{base}/invite/{user.id if user else ''}".rstrip('/')

    text = (
        f"🎉 Hello {username}!\n\n"
        f"Here is your unique invite link to share with friends\n\n"
        f"{deep_link}\n\n"
        f"Invite people and get paid!"
    )

    # Build Telegram share URL to open chat picker with prefilled text
    share_text = "Join me on luckybet Bingo!"
    share_url = (
        "https://t.me/share/url?" +
        urllib.parse.urlencode({
            "url": deep_link,
            "text": share_text,
        })
    )

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("📩 Share Invite Link", url=share_url)],
    ])

    await context.bot.send_message(chat_id=chat_id, text=text, reply_markup=keyboard, parse_mode=ParseMode.HTML)

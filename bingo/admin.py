import os
from typing import Optional

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from asgiref.sync import sync_to_async

from .models import Player


def _get_admin_chat_id() -> Optional[int]:
    val = os.getenv("ADMIN_CHAT_ID")
    try:
        return int(val) if val else None
    except Exception:
        return None


def _is_admin(update: Update) -> bool:
    admin_id = _get_admin_chat_id()
    chat_id = update.effective_chat.id if update.effective_chat else None
    return bool(admin_id is not None and chat_id == admin_id)


async def _ensure_admin(update: Update) -> bool:
    if not _is_admin(update):
        try:
            # Do not leak admin features to players
            await update.effective_message.reply_text("Command not available.")
        except Exception:
            pass
        return False
    return True


def _fmt_player(p: Player) -> str:
    return (
        "```\n"
        f"Telegram ID:   {p.telegram_id}\n"
        f"Username:      {p.username or '-'}\n"
        f"Phone:         {p.phone or '-'}\n"
        f"Balance:       {p.wallet:.2f} ETB\n"
        f"Coin:          {p.gift:.2f}\n"
        "```"
    )


async def admin_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _ensure_admin(update):
        return
    text = (
        "Admin commands:\n"
        "/username <new_username> — change admin username only\n"
    )
    await update.effective_message.reply_text(text)


async def username_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _ensure_admin(update):
        return
    args = context.args or []
    if len(args) < 1:
        await update.effective_message.reply_text("Usage: /username <new_username>")
        return
    new_uname = args[0].lstrip("@")[:64]

    admin_id = _get_admin_chat_id()

    def update_admin():
        p = Player.objects.filter(telegram_id=admin_id).first()
        if not p:
            return None
        p.username = new_uname
        p.save(update_fields=["username"])
        return p

    p = await sync_to_async(update_admin)()
    if not p:
        await update.effective_message.reply_text("Admin player record not found")
        return
    await update.effective_message.reply_text(_fmt_player(p), parse_mode=ParseMode.MARKDOWN)



def register_admin_handlers(application: Application) -> None:
    application.add_handler(CommandHandler(["admin", "help"], admin_help))
    application.add_handler(CommandHandler("username", username_cmd))

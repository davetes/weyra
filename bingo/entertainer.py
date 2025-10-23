import os
from decimal import Decimal, InvalidOperation
from typing import Optional, Tuple
from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import ContextTypes, CommandHandler, Application
from asgiref.sync import sync_to_async
from django.db import transaction
from .models import Player, Transaction


def _is_entertainer(update: Update) -> bool:
    user = update.effective_user
    if not user:
        return False
    # Allow only by explicit entertainer id
    try:
        ent_id_env = os.getenv("ENTERTAINER_ID")
        ent_id = int(ent_id_env) if ent_id_env else None
    except Exception:
        ent_id = None
    if ent_id and user.id == ent_id:
        return True
    return False


async def _resolve_player(identifier: str) -> Optional[Player]:
    """
    identifier can be numeric telegram id or @username
    """
    identifier = (identifier or "").strip()
    if not identifier:
        return None
    if identifier.startswith("@"):
        uname = identifier.lstrip("@")
        def get_by_un():
            return Player.objects.filter(username__iexact=uname).first()
        return await sync_to_async(get_by_un)()
    # try numeric id
    try:
        tid = int(identifier)
    except ValueError:
        return None
    def get_by_tid():
        return Player.objects.filter(telegram_id=tid).first()
    return await sync_to_async(get_by_tid)()


async def balances_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_entertainer(update):
        return
    args = context.args or []
    if len(args) < 1:
        await update.effective_message.reply_text("Usage: /balances <id|@username>")
        return
    player = await _resolve_player(args[0])
    if not player:
        await update.effective_message.reply_text("Player not found")
        return
    wallet = player.wallet or Decimal("0")
    gift = player.gift or Decimal("0")
    text = (
        "```\n"
        f"Username:      {player.username or '-'}\n"
        f"Telegram ID:   {player.telegram_id or '-'}\n"
        f"Wallet:        {wallet:.2f} ETB\n"
        f"Coin:          {gift:.2f}\n"
        "```"
    )
    await update.effective_message.reply_text(text=text, parse_mode=ParseMode.MARKDOWN)


async def add_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_entertainer(update):
        return
    args = context.args or []
    if len(args) < 2:
        await update.effective_message.reply_text("Usage: /add <id> <amount>")
        return
    player = await _resolve_player(args[0])
    if not player:
        await update.effective_message.reply_text("Player not found")
        return
    try:
        amount = Decimal(args[1])
    except (InvalidOperation, ValueError):
        await update.effective_message.reply_text("Invalid amount")
        return
    if amount == 0:
        await update.effective_message.reply_text("Amount must be non-zero")
        return
    def do_add() -> Tuple[Decimal, Decimal]:
        with transaction.atomic():
            p = Player.objects.select_for_update().get(id=player.id)
            before = p.wallet or Decimal("0")
            p.wallet = before + amount
            p.save(update_fields=["wallet"])
            try:
                Transaction.objects.create(
                    player=p,
                    kind="add",
                    amount=amount,
                    note="/add via entertainer",
                    actor_tid=update.effective_user.id if update.effective_user else None,
                )
            except Exception:
                pass
            return before, p.wallet
    try:
        before, after = await sync_to_async(do_add, thread_sensitive=True)()
    except Exception:
        await update.effective_message.reply_text("Failed to update wallet")
        return
    await update.effective_message.reply_text(f"Wallet updated: {before:.2f} → {after:.2f} ETB")


async def subtract_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_entertainer(update):
        return
    args = context.args or []
    if len(args) < 2:
        await update.effective_message.reply_text("Usage: /subtract <id> <amount>")
        return
    player = await _resolve_player(args[0])
    if not player:
        await update.effective_message.reply_text("Player not found")
        return
    try:
        amount = Decimal(args[1])
    except (InvalidOperation, ValueError):
        await update.effective_message.reply_text("Invalid amount")
        return
    if amount <= 0:
        await update.effective_message.reply_text("Amount must be greater than zero")
        return
    def do_subtract() -> Tuple[Decimal, Decimal]:
        with transaction.atomic():
            p = Player.objects.select_for_update().get(id=player.id)
            before = p.wallet or Decimal("0")
            p.wallet = before - amount
            p.save(update_fields=["wallet"])
            try:
                Transaction.objects.create(
                    player=p,
                    kind="add",
                    amount=(Decimal("-1") * amount),
                    note="/subtract via entertainer",
                    actor_tid=update.effective_user.id if update.effective_user else None,
                )
            except Exception:
                pass
            return before, p.wallet
    try:
        before, after = await sync_to_async(do_subtract, thread_sensitive=True)()
    except Exception:
        await update.effective_message.reply_text("Failed to update wallet")
        return
    await update.effective_message.reply_text(f"Wallet updated: {before:.2f} → {after:.2f} ETB")

async def roles_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_entertainer(update):
        return
    text = (
        "🔥 Entertainer Commands\n\n"
        "1) /balances <id|@username>\n"
        "   • Show player's balances (Wallet ETB and Coin).\n"
        "   • Example: /balances 911608626\n"
        "             /balances @username\n\n"
        "2) /add <id|@username> <amount>\n"
        "   • Add ETB amount to wallet.\n"
        "   • Example: /add 911608626 50\n"
        "             /add @username 25.75\n\n"
        "3) /subtract <id|@username> <amount>\n"
        "   • Subtract ETB amount from wallet.\n"
        "   • Example: /subtract 911608626 10\n"
        "             /subtract @username 5.50\n\n"
    )
    await update.effective_message.reply_text(text)


def register_entertainer_handlers(application: Application) -> None:
    application.add_handler(CommandHandler("balances", balances_cmd))
    application.add_handler(CommandHandler("add", add_cmd))
    application.add_handler(CommandHandler("subtract", subtract_cmd))
    application.add_handler(CommandHandler("roles", roles_cmd))

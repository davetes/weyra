import os
from typing import Optional

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, ContextTypes

from asgiref.sync import sync_to_async
from django.core.cache import cache
from django.utils import timezone
from django.db.models import Count, Sum

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
        "/present — show online players count (last 2 minutes)\n"
        "/top10 — show top 10 players by wins\n"
        "/topdaily — top winners today (count and total)\n"
        "/topweekly — top winners this week (count and total)\n"
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


async def present_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _ensure_admin(update):
        return
    def count_present():
        now_ts = int(timezone.now().timestamp())
        tids = list(Player.objects.values_list("telegram_id", flat=True))
        present = 0
        for tid in tids:
            try:
                last_seen = cache.get(f"seen_{tid}")
                if last_seen is not None and int(last_seen) >= now_ts - 120:
                    present += 1
            except Exception:
                continue
        return present, len(tids)
    present, total = await sync_to_async(count_present)()
    await update.effective_message.reply_text(
        f"Players present (last 2 min): {present}\nTotal registered: {total}"
    )


async def top10_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await _ensure_admin(update):
        return
    def top_players():
        qs = list(Player.objects.order_by("-wins", "-wallet")[:10])
        return [(p.username or str(p.telegram_id), getattr(p, 'wins', 0) or 0, p.wallet) for p in qs]
    items = await sync_to_async(top_players)()
    if not items:
        await update.effective_message.reply_text("No players found")
        return
    lines = [f"{i+1}. {name} — {wins} wins — {amount:.2f} ETB" for i, (name, wins, amount) in enumerate(items)]
    text = "Top 10 players by wins:\n" + "\n".join(lines)
    await update.effective_message.reply_text(text)


def _period_bounds(kind: str):
    now = timezone.now()
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_today = start_of_today + timezone.timedelta(days=1) - timezone.timedelta(microseconds=1)
    if kind == "daily":
        return start_of_today, end_of_today
    # weekly: Monday..Sunday of current week
    week_start = start_of_today - timezone.timedelta(days=start_of_today.weekday())
    week_end = (week_start + timezone.timedelta(days=7)) - timezone.timedelta(microseconds=1)
    return week_start, week_end


async def _top_period_cmd(update: Update, period: str) -> None:
    if not await _ensure_admin(update):
        return
    start, end = _period_bounds(period)
    from .models import Transaction
    def aggregate():
        qs = (
            Transaction.objects.filter(created_at__gte=start, created_at__lte=end, note__startswith="Win pot")
            .values("player__telegram_id", "player__username")
            .annotate(win_count=Count("id"), win_amount=Sum("amount"))
            .order_by("-win_count", "-win_amount")[:10]
        )
        return list(qs)
    rows = await sync_to_async(aggregate)()
    if not rows:
        await update.effective_message.reply_text("No wins in this period")
        return
    lines = []
    for i, r in enumerate(rows):
        name = r.get("player__username") or str(r.get("player__telegram_id"))
        cnt = r.get("win_count") or 0
        amt = r.get("win_amount") or 0
        lines.append(f"{i+1}. {name} — {cnt} wins — {amt:.2f} ETB")
    title = "Top winners TODAY" if period == "daily" else "Top winners THIS WEEK"
    await update.effective_message.reply_text(title + ":\n" + "\n".join(lines))


async def topdaily_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _top_period_cmd(update, "daily")


async def topweekly_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _top_period_cmd(update, "weekly")


def register_admin_handlers(application: Application) -> None:
    application.add_handler(CommandHandler(["admin", "help"], admin_help))
    application.add_handler(CommandHandler("username", username_cmd))
    application.add_handler(CommandHandler("present", present_cmd))
    application.add_handler(CommandHandler("top10", top10_cmd))
    application.add_handler(CommandHandler("topdaily", topdaily_cmd))
    application.add_handler(CommandHandler("topweekly", topweekly_cmd))

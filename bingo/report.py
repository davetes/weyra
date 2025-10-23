import os
from datetime import timedelta
from decimal import Decimal
from typing import Tuple
from django.utils import timezone
from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import ContextTypes, CommandHandler, Application
from asgiref.sync import sync_to_async
from .models import Transaction, Game, Selection


def _is_admin(update: Update) -> bool:
    user = update.effective_user
    if not user:
        return False
    try:
        admin_env = os.getenv("ADMIN_CHAT_ID")
        admin_id = int(admin_env) if admin_env else None
    except Exception:
        admin_id = None
    return bool(admin_id and user.id == admin_id)


def _period_bounds(kind: str) -> Tuple[timezone.datetime, timezone.datetime]:
    now = timezone.now()
    # Normalize to start-of-today and end-of-today
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_of_today = start_of_today + timedelta(days=1) - timedelta(microseconds=1)
    if kind == "daily":
        start = start_of_today
        end = end_of_today
    elif kind == "weekly":
        # Current ISO week (Monday..Sunday)
        # Monday 00:00 of this week
        start = start_of_today - timedelta(days=start_of_today.weekday())
        # Sunday 23:59:59.999999 of this week
        end = (start + timedelta(days=7)) - timedelta(microseconds=1)
    elif kind == "monthly":
        # Current month: from 1st 00:00 to last day 23:59:59.999999
        start = start_of_today.replace(day=1)
        if start.month == 12:
            next_month = start.replace(year=start.year + 1, month=1)
        else:
            next_month = start.replace(month=start.month + 1)
        end = next_month - timedelta(microseconds=1)
    else:
        # default daily
        start = start_of_today
        end = end_of_today
    return start, end


async def _aggregate_transactions(start, end):
    def q():
        qs = Transaction.objects.filter(created_at__gte=start, created_at__lte=end)
        # sums
        def sum_kind(k):
            from django.db.models import Sum
            return qs.filter(kind=k).aggregate(s=Sum('amount'))['s'] or Decimal('0')
        from django.db.models import Sum
        deposit = sum_kind('deposit')
        withdraw = sum_kind('withdraw')
        # Split 'add' adjustments into positive adds and subtracts (negative adds)
        add_pos = qs.filter(kind='add', amount__gt=0).aggregate(s=Sum('amount'))['s'] or Decimal('0')
        subtract = -(qs.filter(kind='add', amount__lt=0).aggregate(s=Sum('amount'))['s'] or Decimal('0'))
        set_adj = sum_kind('set_adj')
        # Total should be deposits - withdrawals only (exclude set adjustments)
        add_net = (add_pos or Decimal('0')) - (subtract or Decimal('0'))
        total_adj = add_net
        return deposit, withdraw, add_pos, subtract, set_adj, total_adj
    return await sync_to_async(q)()


async def _aggregate_games(start, end):
    def q():
        from django.db.models import Count
        # Financials: finished games within period (approx by created_at window)
        games = Game.objects.filter(finished=True, created_at__gte=start, created_at__lte=end)
        # Played count: games that actually started within the period
        games_count = Game.objects.filter(started_at__gte=start, started_at__lte=end).count()
        total_stakes = Decimal('0')
        for g in games:
            cnt = Selection.objects.filter(game=g, accepted=True).count()
            total_stakes += Decimal(str(g.stake)) * Decimal(str(cnt))
        # House profit is 20% of total stakes
        profit = (total_stakes * Decimal('0.20')).quantize(Decimal('0.01'))
        derash = (total_stakes * Decimal('0.80')).quantize(Decimal('0.01'))
        return total_stakes.quantize(Decimal('0.01')), derash, profit, games_count
    return await sync_to_async(q)()


async def report_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _is_admin(update):
        return
    args = (context.args or [])
    period = (args[0].lower() if args else 'daily')
    if period not in {'daily','weekly','monthly'}:
        period = 'daily'
    start, end = _period_bounds(period)

    deposit, withdraw, add, subtract, set_adj, total_adj = await _aggregate_transactions(start, end)
    total_stakes, derash, profit, games_count = await _aggregate_games(start, end)

    text = (
        "````\n"
        f"Report: {period.upper()}\n"
        f"From: {start:%Y-%b-%a %H:%M}  To: {end:%Y-%b-%a %H:%M}\n"
        "----------------------------------------\n"
        f"Deposits:      {add:.2f} ETB\n"
        f"Withdrawals:   {subtract:.2f} ETB\n"
        f"Total:         {total_adj:.2f} ETB\n"
        "----------------------------------------\n"
        f"Games played:  {games_count}\n"
        f"Games stakes:  {total_stakes:.2f} ETB\n"
        f"Derash (80%):  {derash:.2f} ETB\n"
        f"Profit (20%):  {profit:.2f} ETB\n"
        "```"
    )
    await update.effective_message.reply_text(text=text, parse_mode=ParseMode.MARKDOWN)


def register_report_handlers(application: Application) -> None:
    application.add_handler(CommandHandler("report", report_cmd))

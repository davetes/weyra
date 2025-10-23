from decimal import Decimal
from telegram import Update, ReplyKeyboardRemove
from telegram.ext import ContextTypes
from telegram.constants import ParseMode
from asgiref.sync import sync_to_async

from .models import Player


async def start_convert(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    username = (user.username if user else None) or "-"

    def get_info():
        p = Player.objects.filter(telegram_id=user.id if user else 0).only("username", "wallet", "gift").first()
        if not p:
            return "-", Decimal("0"), Decimal("0")
        return (p.username or "-"), (p.wallet or Decimal("0")), (p.gift or Decimal("0"))

    uname, wallet, gift = await sync_to_async(get_info)()

    context.user_data["convert_state"] = "await_amount"
    await update.effective_message.reply_text("Please enter the amount you want to convert:", reply_markup=ReplyKeyboardRemove())

    # Show current balances like the sample
    text = (
        "```\n"
        f"Username:     {uname}\n"
        f"Balance:      {wallet:.2f} ETB\n"
        f"Coin:         {gift:.2f}\n"
        "```"
    )
    await update.effective_message.reply_text(text, parse_mode=ParseMode.MARKDOWN)


async def handle_convert(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if context.user_data.get("convert_state") != "await_amount":
        return

    txt = (update.message.text or "").strip()
    if txt.lower() in {"cancel", "/cancel"}:
        context.user_data.pop("convert_state", None)
        await update.message.reply_text("Conversion cancelled.")
        return

    try:
        amt = Decimal(txt)
    except Exception:
        await update.message.reply_text("Please enter a valid number amount.")
        return

    if amt <= 0:
        await update.message.reply_text("Amount must be greater than 0.")
        return

    user = update.effective_user
    if not user:
        await update.message.reply_text("Unable to process your request right now.")
        return

    def convert_coins():
        p = Player.objects.filter(telegram_id=user.id).first()
        if not p:
            return None, None
        gift = p.gift or Decimal("0")
        if gift < amt:
            return gift, None
        p.gift = gift - amt
        p.wallet = (p.wallet or Decimal("0")) + amt
        p.save(update_fields=["gift", "wallet"])
        return p.gift, p.wallet

    new_gift, new_wallet = await sync_to_async(convert_coins)()
    if new_gift is None and new_wallet is None:
        await update.message.reply_text("Please register first using /start and share your phone number.")
        return
    if new_wallet is None:
        await update.message.reply_text("Insufficient coin to convert.")
        return

    # Clear state
    context.user_data.pop("convert_state", None)

    # Show final balances like the sample
    result = (
        "```\n"
        f"Balance:      {Decimal(new_wallet):.2f} ETB\n"
        f"Coin:         {Decimal(new_gift):.2f}\n"
        "```"
    )
    await update.message.reply_text(result, parse_mode=ParseMode.MARKDOWN)

import re
from decimal import Decimal
from telegram import Update, ReplyKeyboardRemove
from telegram.ext import ContextTypes
from asgiref.sync import sync_to_async

from .models import Player

MIN_TRANSFER = Decimal("20.00")
MAX_TRANSFER = Decimal("500.00")


def _normalize_phone(p: str) -> str:
    s = re.sub(r"\s+|[-_]", "", p or "")
    return s


def _alt_formats(p: str) -> list[str]:
    out = {p}
    if p.startswith("0"):
        out.add("+251" + p[1:])
    if p.startswith("+251"):
        out.add("0" + p[4:])
    return list(out)


async def start_transfer(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    context.user_data["transfer_state"] = "await_phone"
    context.user_data["transfer"] = {}
    await update.effective_message.reply_text(
        "Enter the phone number of the person you want to transfer money to 📞:",
        reply_markup=ReplyKeyboardRemove(),
    )


async def handle_transfer(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    state = context.user_data.get("transfer_state")
    if not state:
        return

    text = (update.message.text or "").strip()
    if text.lower() in {"cancel", "/cancel"}:
        context.user_data.pop("transfer_state", None)
        context.user_data.pop("transfer", None)
        await update.message.reply_text("Transfer cancelled.")
        return

    # Step 1: recipient phone
    if state == "await_phone":
        phone = _normalize_phone(text)
        if not re.fullmatch(r"[+]?\d{9,13}", phone or ""):
            await update.message.reply_text("Please enter a valid phone number :")
            return

        # Find a registered recipient by phone
        def find_recipient():
            qs = Player.objects.filter(phone__in=_alt_formats(phone))
            return qs.only("telegram_id", "username", "phone", "wallet").first()

        recipient = await sync_to_async(find_recipient)()
        if not recipient:
            await update.message.reply_text("No registered user found with that phone number.")
            return
        # Disallow self as recipient
        try:
            me_id = update.effective_user.id if update.effective_user else None
        except Exception:
            me_id = None
        if me_id and recipient.telegram_id == me_id:
            await update.message.reply_text("You cannot transfer to yourself. Please enter a different phone number:")
            return

        context.user_data["transfer"] = {"recipient_tid": recipient.telegram_id, "recipient_phone": recipient.phone}
        context.user_data["transfer_state"] = "await_amount"
        await update.message.reply_text(
            (
                "Here are the min and max amount you can transfer\n"
                f"Min Amount:       {MIN_TRANSFER:.0f} ETB \n"
                f"Max Amount:      {MAX_TRANSFER:.0f} ETB"
            )
        )
        await update.message.reply_text("Please enter the amount:")
        return

    # Step 2: amount
    if state == "await_amount":
        try:
            amt = Decimal(text)
        except Exception:
            await update.message.reply_text("Please enter a valid number amount.")
            return

        if amt < MIN_TRANSFER or amt > MAX_TRANSFER:
            await update.message.reply_text(
                (
                    "Here are the min and max amount you can transfer\n"
                    f"Min Amount:       {MIN_TRANSFER:.0f} ETB \n"
                    f"Max Amount:      {MAX_TRANSFER:.0f} ETB"
                )
            )
            await update.message.reply_text("Please enter the amount:")
            return

        user = update.effective_user
        if not user:
            await update.message.reply_text("Unable to process your request right now.")
            return

        info = context.user_data.get("transfer") or {}
        recipient_tid = info.get("recipient_tid")
        if not recipient_tid:
            await update.message.reply_text("Session expired. Please run /transfer again.")
            context.user_data.pop("transfer_state", None)
            context.user_data.pop("transfer", None)
            return
        # Disallow self-transfer
        if recipient_tid == user.id:
            await update.message.reply_text("You cannot transfer to yourself.")
            context.user_data.pop("transfer_state", None)
            context.user_data.pop("transfer", None)
            return

        # Perform transfer
        def do_transfer():
            sender = Player.objects.filter(telegram_id=user.id).first()
            recipient = Player.objects.filter(telegram_id=recipient_tid).first()
            if not sender or not recipient:
                return None, None, None
            sbal = sender.wallet or Decimal("0")
            if sbal < amt:
                return sbal, None, None
            sender.wallet = sbal - amt
            recipient.wallet = (recipient.wallet or Decimal("0")) + amt
            sender.save(update_fields=["wallet"])
            recipient.save(update_fields=["wallet"])
            return sender.wallet, recipient.wallet, recipient.username or "-"

        new_sender_bal, new_recipient_bal, recipient_username = await sync_to_async(do_transfer)()
        if new_sender_bal is None and new_recipient_bal is None:
            await update.message.reply_text("Please register first using /start and share your phone number.")
            return
        if new_recipient_bal is None:
            await update.message.reply_text("You don't have a sufficient amount to withdraw. Please try again.")
            return

        # Clear state
        context.user_data.pop("transfer_state", None)
        context.user_data.pop("transfer", None)

        # Notify sender
        await update.message.reply_text(
            (
                f"Transfer successful.\n"
                f"Sent: {amt:.2f} ETB\n"
                f"To: {recipient_username} ({info.get('recipient_phone', '-')})\n"
                f"New Balance: {new_sender_bal:.2f} ETB"
            )
        )

        # Notify recipient (best-effort)
        try:
            await context.bot.send_message(
                chat_id=recipient_tid,
                text=(
                    "You have received a transfer.\n"
                    f"Amount: +{amt:.2f} ETB\n"
                    f"New Balance: {new_recipient_bal:.2f} ETB"
                ),
            )
        except Exception:
            pass
        return

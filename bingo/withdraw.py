import os
from decimal import Decimal
from telegram import Update, ReplyKeyboardRemove, ReplyKeyboardMarkup, KeyboardButton
from telegram.ext import ContextTypes
from telegram.constants import ParseMode
from asgiref.sync import sync_to_async

from .models import Player


MIN_WITHDRAW = Decimal("100.00")
WITHDRAW_METHODS = [
    ("telebirr", "Telebirr"),
    ("cbe_birr", "CBE Birr"),
    ("boa", "BOA"),
    ("cbe", "CBE"),
]


async def start_withdraw(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    # Initialize withdraw conversation state
    context.user_data["withdraw_state"] = "await_amount"
    context.user_data["withdraw"] = {}
    await update.effective_message.reply_text(
        "Please enter the amount you wish to withdraw.", reply_markup=ReplyKeyboardRemove()
    )


async def handle_withdraw_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    # Backward compatibility with previous flag
    if context.user_data.get("await_withdraw_amount") and not context.user_data.get("withdraw_state"):
        context.user_data["withdraw_state"] = "await_amount"
        context.user_data["withdraw"] = {}

    state = context.user_data.get("withdraw_state")
    if not state:
        return

    text = (update.message.text or "").strip()
    # Simple cancel hook
    if text.lower() in {"cancel", "/cancel"}:
        context.user_data.pop("withdraw_state", None)
        context.user_data.pop("withdraw", None)
        context.user_data.pop("await_withdraw_amount", None)
        await update.message.reply_text("Withdraw cancelled.")
        return

    # Step 1: amount
    if state == "await_amount":
        try:
            amt = Decimal(text)
        except Exception:
            await update.message.reply_text("Please enter a valid number amount.")
            return

        if amt < MIN_WITHDRAW:
            await update.message.reply_text(
                f"Withdraw amount must be greater than or equal to {MIN_WITHDRAW:.0f}"
            )
            return

        user = update.effective_user
        if not user:
            await update.message.reply_text("Unable to process your request right now.")
            return

        def load_player():
            p = Player.objects.filter(telegram_id=user.id).first()
            if not p:
                return None, None, None
            bal = p.wallet or Decimal("0")
            phone = p.phone or "-"
            return p, bal, phone

        p, before, phone = await sync_to_async(load_player)()
        if before is None:
            await update.message.reply_text("Please register first using /start and share your phone number.")
            return

        if before < amt:
            await update.message.reply_text(
                f"Insufficient fund. user: {user.id}, amount: {amt:.1f}."
            )
            return

        # Store for next steps
        context.user_data["withdraw"] = {"amount": amt, "balance": before, "phone": phone}
        context.user_data["withdraw_state"] = "await_method"

        # Ask for method
        kb = ReplyKeyboardMarkup(
            [[KeyboardButton(lbl) for _key, lbl in WITHDRAW_METHODS], [KeyboardButton("Cancel")]],
            resize_keyboard=True,
            one_time_keyboard=True,
            input_field_placeholder="Choose withdraw method",
        )
        await update.message.reply_text("Please choose your withdraw method:", reply_markup=kb)
        return

    # Step 2: method
    if state == "await_method":
        norm = text.strip().lower()
        matched = None
        for key, lbl in WITHDRAW_METHODS:
            if norm in {key, lbl.lower()}:
                matched = key
                display = lbl
                break
        if not matched:
            await update.message.reply_text("Please choose a valid method: Telebirr, CBE Birr, BOA, or CBE.")
            return

        context.user_data["withdraw"]["method"] = matched
        context.user_data["withdraw"]["method_label"] = display
        context.user_data["withdraw_state"] = "await_account"
        await update.message.reply_text(
            f"Enter your {display} account/phone to receive the withdrawal:",
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    # Step 3: account details
    if state == "await_account":
        account = text
        info = context.user_data.get("withdraw") or {}
        amt = info.get("amount")
        before = info.get("balance")
        phone = info.get("phone") or "-"
        method_label = info.get("method_label") or "-"

        # Clear state
        context.user_data.pop("withdraw_state", None)
        context.user_data.pop("withdraw", None)
        context.user_data.pop("await_withdraw_amount", None)
        user = update.effective_user
        if not user or amt is None or before is None:
            await update.message.reply_text("Unable to process your request right now.")
            return

        # Notify entertainer for manual processing
        ent_chat = os.getenv("ENTERTAINER_ID")
        ent_id_val = None
        if ent_chat:
            try:
                ent_id_val = int(ent_chat)
            except Exception:
                ent_id_val = None

        username = (update.effective_user.username if update.effective_user else None) or "-"
        if ent_id_val is not None:
            try:
                await context.bot.send_message(
                    chat_id=ent_id_val,
                    text=(
                        "Withdrawal Request\n"
                        f"User: @{username} (id: {user.id})\n"
                        f"Phone: {phone}\n"
                        f"Amount: {amt:.2f} ETB\n"
                        f"Method: {method_label}\n"
                        f"Account: {account}\n"
                        f"Current Balance: {before:.2f} ETB\n"
                    ),
                    parse_mode=ParseMode.HTML,
                )
            except Exception:
                pass

        await update.message.reply_text(
            (
                "Your withdrawal request has been received and is being processed by admin.\n"
                f"Requested Amount: {amt:.2f} ETB\n"
                f"Method: {method_label}\n"
                f"Account: {account}\n"
                f"Current Balance: {before:.2f} ETB"
            ),
            parse_mode=ParseMode.HTML,
        )
        return

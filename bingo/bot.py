import os
from decimal import Decimal
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update, WebAppInfo, ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove, BotCommand
from telegram.constants import ParseMode
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes, MessageHandler, filters
from .admin import register_admin_handlers
from .deposit import build_deposit_keyboard, handle_deposit_selection
from .invite import handle_invite
from .withdraw import start_withdraw, handle_withdraw_amount
from .transfer import start_transfer, handle_transfer
from .convert import start_convert, handle_convert
from .entertainer import register_entertainer_handlers
from .report import register_report_handlers
from .models import Player
from asgiref.sync import sync_to_async

BUTTON_ROWS = [
    [
        InlineKeyboardButton("🎮 Play Now", callback_data="play_now"),
    ],
    [
        InlineKeyboardButton("💰 Check Balance", callback_data="check_balance"),
        InlineKeyboardButton("💸 Make a Deposit", callback_data="deposit"),
    ],
    [
        InlineKeyboardButton("Support 📞", callback_data="support"),
        InlineKeyboardButton("📖 Instructions", callback_data="instructions"),
    ],
    [
        InlineKeyboardButton("✉️ Invite", callback_data="invite"),
        InlineKeyboardButton("Win Patterns", callback_data="win_patterns"),
    ],
    
]

def build_stake_keyboard(telegram_id: int | None = None) -> InlineKeyboardMarkup:
    base = os.getenv("WEBAPP_URL", "http://127.0.0.1:8000").rstrip("/")
    def wa(amount: int) -> InlineKeyboardButton:
        tid = f"&tid={telegram_id}" if telegram_id else ""
        return InlineKeyboardButton(
            text=f"🎮 {amount} ETB",
            web_app=WebAppInfo(url=f"{base}/play/?stake={amount}{tid}")
        )
    return InlineKeyboardMarkup([
        [wa(10), wa(20)],
        [wa(50), wa(100)],
        
    ])

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    img_url = os.getenv("START_IMAGE_URL")
    img_path = os.getenv("START_IMAGE_PATH")
    # Capture referral if present: /start ref_<telegram_id>
    try:
        payload = None
        if context.args:
            payload = " ".join(context.args).strip()
        elif update.message and update.message.text:
            parts = update.message.text.split(maxsplit=1)
            if len(parts) == 2:
                payload = parts[1].strip()
        if payload and payload.startswith("ref_"):
            ref_tid_str = payload.removeprefix("ref_")
            ref_tid = int(ref_tid_str)
            me = update.effective_user.id if update.effective_user else None
            if me and ref_tid and ref_tid != me:
                context.user_data["referrer_tid"] = ref_tid
    except Exception:
        pass

    if img_url:
        await context.bot.send_photo(chat_id=chat_id, photo=img_url,caption="🎉 Welcome To roha Bingo! 🎉")
    elif img_path and os.path.exists(img_path):
        with open(img_path, "rb") as f:
            await context.bot.send_photo(chat_id=chat_id, photo=f,caption="🎉 Welcome To roha Bingo! 🎉")

    keyboard = InlineKeyboardMarkup(BUTTON_ROWS)
    await context.bot.send_message(chat_id=chat_id, text="🕹️ Every Square Counts – Grab Your roha, Join the Game, and Let the Fun Begin!", reply_markup=keyboard,parse_mode=ParseMode.HTML)
    user = update.effective_user
    if user:
        exists = await sync_to_async(Player.objects.filter(telegram_id=user.id, phone__gt="").exists)()
        if not exists:
            kb = ReplyKeyboardMarkup(
                [[KeyboardButton(text="Share Phone Number", request_contact=True), KeyboardButton(text="Cancel")]],
                resize_keyboard=True,
                one_time_keyboard=True,
                input_field_placeholder="Tap 'Share Phone Number'",
            )
            await context.bot.send_message(chat_id=chat_id, text="Please Share Your Phone Number", reply_markup=kb)

async def play_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    # If not registered yet, prompt for phone share, same as in button flow
    if user and not await sync_to_async(Player.objects.filter(telegram_id=user.id, phone__gt="").exists)():
        kb = ReplyKeyboardMarkup(
            [[KeyboardButton(text="Share Phone Number", request_contact=True), KeyboardButton(text="Cancel")]],
            resize_keyboard=True,
            one_time_keyboard=True,
            input_field_placeholder="Tap 'Share Phone Number'",
        )
        await update.effective_message.reply_text("Please Share Your Phone Number", reply_markup=kb)
        return
    await update.effective_message.reply_text(
        text="💰 Choose Your Stake, Play Your Luck — The Bigger the Bet, The Bigger the Glory!",
        reply_markup=build_stake_keyboard(user.id if user else None),
        parse_mode=ParseMode.HTML,
    )

async def balance_cmd_user(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    tid = user.id if user else None
    if not tid:
        await update.effective_message.reply_text("Unable to retrieve your balance at the moment.")
        return
    def get_info():
        p = Player.objects.filter(telegram_id=tid).only("username", "wallet", "gift").first()
        if not p:
            return "-", Decimal("0"), Decimal("0")
        return (p.username or "-"), (p.wallet or Decimal("0")), (p.gift or Decimal("0"))
    username, wallet, gift = await sync_to_async(get_info)()
    text = (
        "```\n"
        f"Username:      {username}\n"
        f"Balance:       {wallet:.2f} ETB\n"
        f"Coin:          {gift:.2f}\n"
        "```"
    )
    await update.effective_message.reply_text(text=text, parse_mode=ParseMode.MARKDOWN)

async def deposit_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    # Ensure registration like on_button pre-check
    if user and not await sync_to_async(Player.objects.filter(telegram_id=user.id, phone__gt="").exists)():
        kb = ReplyKeyboardMarkup(
            [[KeyboardButton(text="Share Phone Number", request_contact=True), KeyboardButton(text="Cancel")]],
            resize_keyboard=True,
            one_time_keyboard=True,
            input_field_placeholder="Tap 'Share Phone Number'",
        )
        await update.effective_message.reply_text("Please Share Your Phone Number", reply_markup=kb)
        return
    await update.effective_message.reply_text(
        text="Please select the bank option you wish to use for the top-up.",
        reply_markup=build_deposit_keyboard(),
    )

async def invite_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    # Reuse the same inline keyboard flow as the 'Invite' button
    await handle_invite(update, context)

async def contact_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(
        "Telegram - @Rohabingosupport\nPhone - +251981959155"
    )

async def instruction_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(
        "እንኮን ወደ ሮሃ ቢንጎ መጡ\n\n"
        "1 ለመጫወት ወደቦቱ ሲገቡ register የሚለውን በመንካት ስልክ ቁጥሮትን ያጋሩ\n\n"
        "2 menu ውስጥ በመግባት deposit fund የሚለውን በመንካት በሚፈልጉት የባንክ አካውንት ገንዘብ ገቢ ያድርጉ \n\n"
        "3 menu ውስጥ በመግባት start play የሚለውን በመንካት መወራረድ የሚፈልጉበትን የብር መጠን ይምረጡ።\n\n\n"
        "1 ወደጨዋታው እድገቡ ከሚመጣሎት 100 የመጫወቻ ቁጥሮች መርጠው accept የሚለውን በመንካት የቀጥሉ\n\n"
        "2 ጨዋታው ለመጀመር የተሰጠውን ጊዜ ሲያልቅ ቁጥሮች መውጣት ይጀምራል\n\n"
        "3 የሚወጡት ቁጥሮች የመረጡት ካርቴላ ላይ መኖሩን እያረጋገጡ ያቅልሙ\n\n"
        "4 ያቀለሙት አንድ መስመር ወይንም አራት ጠርዝ ላይ ሲመጣ ቢንጎ በማለት ማሸነፍ የችላሉ\n\n"
        " —አንድ መስመር ማለት\n"
        "    አንድ ወደጎን ወይንም ወደታች ወይንም ዲያጎናል ሲዘጉ\n\n"
        " — አራት ጠርዝ ልይ ሲመጣሎት \n\n"
        "5 እነዚህ ማሸነፊያ ቁጥሮች ሳይመጣሎት bingo እሚለውን ከነኩ ከጨዋታው ይባረራሉ\n\n"
        "ማሳሰቢያ\n\n"
        "1 የጨዋታ ማስጀመሪያ ሰከንድ (countdown) ሲያልቅ ያሉት ተጫዋች ብዛት ከ2 በታች ከሆነ ያ ጨዋታ አይጀመርም \n"
        "2 ጨዋታ ከጀመረ በህዋላ ካርቴላ መምረጥ \n"
        "3 እርሶ በዘጉበት ቁጥር ሌላ ተጫዋች ዘግቶ ቀድሞ bingo ካለ አሸናፊነትዋን ያጣሉ\n\n"
        "📝ስለሆነም እንዚህን ማሳሰቢያዎች ተመልክተው እንዲጠቀሙበት ሮሃ ቢንጎ ያሳስባል"
    )

async def register(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if user and await sync_to_async(Player.objects.filter(telegram_id=user.id, phone__gt="").exists)():
        await update.message.reply_text("You are already registered.")
        return
    kb = ReplyKeyboardMarkup(
        [[KeyboardButton(text="Share Phone Number", request_contact=True), KeyboardButton(text="Cancel")]],
        resize_keyboard=True,
        one_time_keyboard=True,
        input_field_placeholder="Tap 'Share Phone Number'",
    )
    chat_id = update.effective_chat.id if update.effective_chat else None
    if chat_id:
        await context.bot.send_message(chat_id=chat_id, text="Please Share Your Phone Number", reply_markup=kb)

async def on_contact(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    contact = update.message.contact
    user = update.effective_user
    if not contact or not user:
        return
    phone = contact.phone_number or ""
    def upsert():
        obj, _created = Player.objects.get_or_create(telegram_id=user.id)
        first_phone = not obj.phone and bool(phone)
        obj.phone = phone
        obj.username = user.username or ""
        if first_phone:
            obj.wallet = (obj.wallet or Decimal("0")) + Decimal("20.00")
        obj.save()
        return first_phone, obj.wallet
    first_time, balance = await sync_to_async(upsert)()
    if first_time:
        await update.message.reply_text(
            f"Registration completed. You received 20 ETB. Wallet: {balance}",
            reply_markup=ReplyKeyboardRemove(),
        )
        # Reward referrer (if any) with 20 ETB
        ref_tid = context.user_data.get("referrer_tid")
        if ref_tid and ref_tid != user.id:
            def reward_referrer():
                ref = Player.objects.filter(telegram_id=ref_tid).first()
                if not ref:
                    return None
                ref.wallet = (ref.wallet or Decimal("0")) + Decimal("20.00")
                ref.save(update_fields=["wallet"])
                return ref.wallet
            try:
                new_ref_balance = await sync_to_async(reward_referrer)()
                if new_ref_balance is not None:
                    try:
                        await context.bot.send_message(
                            chat_id=ref_tid,
                            text=(
                                "🎉 Referral bonus received!\n"
                                f"A new player joined using your link. +20.00 ETB\n"
                                f"New Wallet: {Decimal(new_ref_balance):.2f} ETB"
                            ),
                            parse_mode=ParseMode.HTML,
                        )
                    except Exception:
                        pass
            except Exception:
                pass
    else:
        await update.message.reply_text(
            "Registration completed. Thank you.",
            reply_markup=ReplyKeyboardRemove(),
        )
    # Show main menu like the image after registration
    chat_id = update.effective_chat.id if update.effective_chat else None
    if chat_id:
        await context.bot.send_message(
            chat_id=chat_id,
            text="🕹️ Every Square Counts – Grab Your luckbet, Join the Game, and Let the Fun Begin!",
            reply_markup=InlineKeyboardMarkup(BUTTON_ROWS),
            parse_mode=ParseMode.HTML,
        )

async def on_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    data = query.data or ""
    user = update.effective_user
    # Copy user id helper from receipt meta
    if data.startswith("copy_tid:"):
        tid_to_copy = data.split(":", 1)[1]
        # Show as alert so admin can long-press/copy
        try:
            await query.answer(text=f"User ID: {tid_to_copy}", show_alert=True)
        except Exception:
            pass
        return
    # If not registered yet, prompt for phone share
    if user and not await sync_to_async(Player.objects.filter(telegram_id=user.id, phone__gt="").exists)():
        kb = ReplyKeyboardMarkup(
            [[KeyboardButton(text="Share Phone Number", request_contact=True), KeyboardButton(text="Cancel")]],
            resize_keyboard=True,
            one_time_keyboard=True,
            input_field_placeholder="Tap 'Share Phone Number'",
        )
        await query.message.reply_text("Please Share Your Phone Number", reply_markup=kb)
        return

    if data == "play_now":
        # Send a new message so the previous welcome/menu remains visible
        await query.message.reply_text(
            text="💰 Choose Your Stake, Play Your Luck — The Bigger the Bet, The Bigger the Glory!",
            reply_markup=build_stake_keyboard(user.id if user else None),
            parse_mode=ParseMode.HTML,
        )
        return

    # stake_* callbacks are no longer needed because stake buttons open the WebApp directly
    if data == "deposit":
        await query.message.reply_text(
            text="Please select the bank option you wish to use for the top-up.",
            reply_markup=build_deposit_keyboard(),
        )
        return

    if data == "win_patterns":
        caption = (
            "🎯 From straight lines to funky shapes – every pattern is a chance to WIN BIG! "
            "Know the pattern, play smart, and shout BINGO when the stars align!"
        )
        img_url = os.getenv("WIN_PATTERNS_IMAGE_URL")
        img_path = os.getenv("WIN_PATTERNS_IMAGE_PATH")
        try:
            if img_url:
                await query.message.reply_photo(photo=img_url, caption=caption)
            elif img_path:
                # Support project-relative static paths like \static\images\pattern.jpg
                p = img_path
                if not os.path.isabs(p):
                    p = os.path.join(os.getcwd(), p.lstrip("/\\"))
                p = os.path.abspath(p)
                if os.path.exists(p):
                    with open(p, "rb") as f:
                        await query.message.reply_photo(photo=f, caption=caption)
                else:
                    await query.message.reply_text(caption)
            else:
                await query.message.reply_text(caption)
        except Exception:
            await query.message.reply_text(caption)
        return

    # If a deposit option is chosen, delegate to deposit handler
    if data in {"deposit_cbe", "deposit_boa", "deposit_telebirr", "deposit_cbe_birr"}:
        await handle_deposit_selection(update, context)
        return

    if data == "invite":
        await handle_invite(update, context)
        return

    if data == "check_balance":
        tid = user.id if user else None
        if not tid:
            await query.message.reply_text("Unable to retrieve your balance at the moment.")
            return
        def get_info():
            p = Player.objects.filter(telegram_id=tid).only("username", "wallet", "gift").first()
            if not p:
                return "-", Decimal("0"), Decimal("0")
            return (p.username or "-"), (p.wallet or Decimal("0")), (p.gift or Decimal("0"))
        username, wallet, gift = await sync_to_async(get_info)()
        text = (
            "```\n"
            f"Username:      {username}\n"
            f"Balance:       {wallet:.2f} ETB\n"
            f"Coin:          {gift:.2f}\n"
            "```"
        )
        await query.message.reply_text(text=text, parse_mode=ParseMode.MARKDOWN)
        return

    responses = {
        "play_now": "Starting a new game...",
        "check_balance": "Your balance is currently 0.",
        "support": "Telegram - @Rohabingosupport\nPhone - +251981959155",
        "instructions": (
            "እንኮን ወደ ሮሃ ቢንጎ መጡ\n\n"
            "1 ለመጫወት ወደቦቱ ሲገቡ register የሚለውን በመንካት ስልክ ቁጥሮትን ያጋሩ\n\n"
            "2 menu ውስጥ በመግባት deposit fund የሚለውን በመንካት በሚፈልጉት የባንክ አካውንት ገንዘብ ገቢ ያድርጉ \n\n"
            "3 menu ውስጥ በመግባት start play የሚለውን በመንካት መወራረድ የሚፈልጉበትን የብር መጠን ይምረጡ።\n\n\n"
            "1 ወደጨዋታው እድገቡ ከሚመጣሎት 100 የመጫወቻ ቁጥሮች መርጠው accept የሚለውን በመንካት የቀጥሉ\n\n"
            "2 ጨዋታው ለመጀመር የተሰጠውን ጊዜ ሲያልቅ ቁጥሮች መውጣት ይጀምራል\n\n"
            "3 የሚወጡት ቁጥሮች የመረጡት ካርቴላ ላይ መኖሩን እያረጋገጡ ያቅልሙ\n\n"
            "4 ያቀለሙት አንድ መስመር ወይንም አራት ጠርዝ ላይ ሲመጣ ቢንጎ በማለት ማሸነፍ የችላሉ\n"
            " —አንድ መስመር ማለት\n"
            "    አንድ ወደጎን ወይንም ወደታች ወይንም ዲያጎናል ሲዘጉ\n"
            " — አራት ጠርዝ ልይ ሲመጣሎት \n\n"
            "5 እነዚህ ማሸነፊያ ቁጥሮች ሳይመጣሎት bingo እሚለውን ከነኩ ከጨዋታው ይባረራሉ\n\n"
            "ማሳሰቢያ\n\n"
            "1 የጨዋታ ማስጀመሪያ ሰከንድ (countdown) ሲያልቅ ያሉት ተጫዋች ብዛት ከ2 በታች ከሆነ ያ ጨዋታ አይጀመርም \n"
            "2 ጨዋታ ከጀመረ በህዋላ ካርቴላ መምረጫ ቦርዱ ይፀዳል\n"
            "3 እርሶ በዘጉበት ቁጥር ሌላ ተጫዋች ዘግቶ ቀድሞ bingo ካለ አሸናፊነትዋን ያጣሉ\n\n"
            "📝ስለሆነም እንዚህን ማሳሰቢያዎች ተመልክተው እንዲጠቀሙበት ካርቴላ ቢንጎ ያሳስባል"
        ),
        "invite": "Share this bot with friends!",
        "win_patterns": "View winning patterns here.",
        "change_username": "Username change flow coming soon.",
        "dashboard": "dashboard coming soon.",
    }
    await query.message.reply_text(text=responses.get(data, "Working on it..."))

async def forward_receipt(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    admin_chat = os.getenv("ENTERTAINER_ID")
    if not admin_chat:
        # No admin configured; optionally notify the user
        return
    try:
        admin_id = int(admin_chat)
    except ValueError:
        # If it's not an integer chat id, attempt to resolve (best-effort)
        try:
            chat = await context.bot.get_chat(admin_chat)
            admin_id = chat.id
        except Exception:
            return

    user = update.effective_user
    msg = update.message
    if not msg:
        return

    # Forward the original message (photo or image document)
    try:
        await context.bot.forward_message(chat_id=admin_id, from_chat_id=msg.chat_id, message_id=msg.message_id)
    except Exception:
        pass

    # Compose metadata: username/id and phone if registered
    username = (user.username if user else None) or "-"
    tid = (user.id if user else None)
    phone = "-"
    if tid:
        try:
            def get_phone():
                p = Player.objects.filter(telegram_id=tid).only("phone").first()
                return p.phone if p and p.phone else "-"
            phone = await sync_to_async(get_phone)()
        except Exception:
            phone = "-"

    caption = msg.caption or ""
    meta = (
        f"Receipt forwarded\n"
        f"User: @{username} (id: <code>{tid}</code>)\n"
        f"Phone: {phone}\n"
       f"caption:{caption}"
    )
    try:
        kb = None
        if tid:
            from telegram import InlineKeyboardMarkup, InlineKeyboardButton
            kb = InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("Open User", url=f"tg://user?id={tid}"),
                    InlineKeyboardButton("Copy ID", callback_data=f"copy_tid:{tid}"),
                ]
            ])
        await context.bot.send_message(chat_id=admin_id, text=meta, parse_mode=ParseMode.HTML, reply_markup=kb)
    except Exception:
        pass

    # Acknowledge to the sender
    try:
        await msg.reply_text("Your receipt has been forwarded for verification. Thank you.")
    except Exception:
        pass

async def _set_bot_commands(app: Application) -> None:
    commands = [
        BotCommand("start", "Start the bot"),
        BotCommand("play", "Start playing"),
        BotCommand("transfer", "To transfer funds"),
        BotCommand("withdraw", "To withdraw"),
        BotCommand("balance", "Check balance"),
        BotCommand("deposit", "Deposit funds"),
        BotCommand("convert", "Convert coins to wallet"),
        BotCommand("instruction", "Game Instruction"),
        BotCommand("invite", "Invite friends"),
        BotCommand("contact", "Contact Support"),
    ]
    await app.bot.set_my_commands(commands)

def build_application() -> Application:
    token = os.getenv("BOT_TOKEN")
    if not token:
        raise RuntimeError("BOT_TOKEN not set in environment/.env")
    return Application.builder().token(token).post_init(_set_bot_commands).build()

def setup(application: Application) -> None:
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("play", play_cmd))
    application.add_handler(CommandHandler("balance", balance_cmd_user))
    application.add_handler(CommandHandler("deposit", deposit_cmd))
    application.add_handler(CommandHandler("invite", invite_cmd))
    application.add_handler(CommandHandler("contact", contact_cmd))
    application.add_handler(CommandHandler("instruction", instruction_cmd))
    application.add_handler(CommandHandler("withdraw", start_withdraw))
    application.add_handler(CommandHandler("transfer", start_transfer))
    application.add_handler(CommandHandler("convert", start_convert))
    application.add_handler(MessageHandler(filters.CONTACT, on_contact))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text_router))
    # Forward photo or image documents to admin for verification
    application.add_handler(MessageHandler(filters.PHOTO | filters.Document.IMAGE, forward_receipt))
    application.add_handler(CallbackQueryHandler(on_button))
    # Register admin-only commands (restricted by ADMIN_CHAT_ID)
    register_admin_handlers(application)
    # Register entertainer commands (restricted by username or admin id)
    register_entertainer_handlers(application)
    # Register admin-only reporting commands
    register_report_handlers(application)

async def handle_text_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    # Route to the correct conversation based on state flags
    u = context.user_data or {}
    if u.get("withdraw_state") or u.get("await_withdraw_amount"):
        await handle_withdraw_amount(update, context)
        return
    if u.get("transfer_state"):
        await handle_transfer(update, context)
        return
    if u.get("convert_state"):
        await handle_convert(update, context)
        return
    # No active flow; ignore or add generic handling here if needed
    return

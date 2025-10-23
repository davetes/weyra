from django.core.management.base import BaseCommand
from bingo.bot import build_application, setup

class Command(BaseCommand):
    help = "Run the Telegram bot with polling"

    def handle(self, *args, **options):
        app = build_application()
        setup(app)
        self.stdout.write(self.style.SUCCESS("Starting Telegram bot (polling)..."))
        app.run_polling(close_loop=False)  # keep Django-managed loop

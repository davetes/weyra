from django.db import models
from django.utils import timezone

class Player(models.Model):
    telegram_id = models.BigIntegerField(unique=True, db_index=True)
    phone = models.CharField(max_length=32, blank=True, default="")
    username = models.CharField(max_length=64, blank=True, default="")
    wallet = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    gift = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    wins = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.telegram_id} - {self.phone or 'no-phone'}"


class Game(models.Model):
    stake = models.IntegerField()
    active = models.BooleanField(default=True)
    finished = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    countdown_started_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    sequence = models.TextField(blank=True, default="")  # comma-separated call order (1..75)
    stakes_charged = models.BooleanField(default=False)
    charged_count = models.IntegerField(default=0)

    def start_countdown(self):
        if not self.countdown_started_at:
            self.countdown_started_at = timezone.now()
            self.save(update_fields=["countdown_started_at"])


class Selection(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="selections")
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="selections")
    index = models.IntegerField()
    accepted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = (
            ("game", "index"),  # one card per game
            ("game", "player"), # one selection per player per game
        )


class Transaction(models.Model):
    KIND_CHOICES = [
        ("deposit", "Deposit"),
        ("withdraw", "Withdraw"),
        ("add", "Entertainer Add"),
        ("set_adj", "Entertainer Set Adjustment"),
        ("other", "Other"),
    ]
    player = models.ForeignKey(Player, on_delete=models.SET_NULL, null=True, blank=True, related_name="transactions")
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    note = models.CharField(max_length=255, blank=True, default="")
    actor_tid = models.BigIntegerField(null=True, blank=True, help_text="Telegram ID who initiated this transaction")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["created_at", "kind"]),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.kind} {self.amount}"

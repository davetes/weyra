import json
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from .models import Game, Selection, Player
from .models import Transaction
from .utils import get_card
import random
from django.db import transaction
from decimal import Decimal

class GameConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.stake = int(self.scope['url_route']['kwargs']['stake'])
        self.group_name = f"game_{self.stake}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        action = content.get('action')
        if action == 'claim_bingo':
            tid = content.get('tid')
            picks = content.get('picks')  # optional list of numbers (as strings or ints)
            await self.handle_claim(tid, picks)
        elif action == 'ping':
            await self.send_json({'type': 'pong'})

    @database_sync_to_async
    def _check_and_finalize_bingo(self, tid: str):
        if not tid or not str(tid).isdigit():
            return {'ok': False, 'reason': 'no_tid'}
        stake = self.stake
        # Find current active game for stake
        game = Game.objects.filter(stake=stake, active=True).order_by('-id').first()
        if not game or not game.started_at or not game.sequence:
            return {'ok': False, 'reason': 'not_started'}
        try:
            player = Player.objects.get(telegram_id=int(tid))
        except Player.DoesNotExist:
            return {'ok': False, 'reason': 'player_not_found'}
        sel = Selection.objects.filter(game=game, player=player, accepted=True).first()
        if not sel:
            return {'ok': False, 'reason': 'no_card'}
        # Build called set (3s cadence to match views and clients)
        elapsed = int((timezone.now() - game.started_at).total_seconds())
        step = max(0, elapsed // 3)
        seq = [int(x) for x in game.sequence.split(',') if x]
        called = set(seq[:min(step+1, len(seq))])
        card = get_card(sel.index)

        def cell_ok(val):
            return True if val == 'FREE' else (val in called)
        # rows
        for r in range(5):
            if all(cell_ok(card[r][c]) for c in range(5)):
                return {'ok': True, 'pattern': 'row', 'row': r, 'index': sel.index, 'player': player.username or str(player.telegram_id)}
        # cols
        for c in range(5):
            if all(cell_ok(card[r][c]) for r in range(5)):
                return {'ok': True, 'pattern': 'col', 'col': c, 'index': sel.index, 'player': player.username or str(player.telegram_id)}
        # diags
        if all(cell_ok(card[i][i]) for i in range(5)):
            return {'ok': True, 'pattern': 'diag_main', 'index': sel.index, 'player': player.username or str(player.telegram_id)}
        if all(cell_ok(card[i][4-i]) for i in range(5)):
            return {'ok': True, 'pattern': 'diag_anti', 'index': sel.index, 'player': player.username or str(player.telegram_id)}
        return {'ok': False, 'reason': 'not_bingo'}

    @database_sync_to_async
    def _restart_new_game(self):
        # Close current active game and create a brand new one at same stake
        game = Game.objects.filter(stake=self.stake, active=True).order_by('-id').first()
        if game:
            # Deactivate finished game
            game.active = False
            game.save(update_fields=["active"])
            # Purge selections of the finished game so no carry-over
            Selection.objects.filter(game=game).delete()
        # Start a fresh game (no countdown, no sequence, no selections)
        new_game = Game.objects.create(stake=self.stake, active=True)
        return new_game.id

    async def handle_claim(self, tid: str, picks=None):
        result = await self._check_and_finalize_bingo(tid)
        if result.get('ok'):
            # award winner and finish the game (same logic as HTTP path)
            amount = await self._award_and_finish_by_tid(tid)
            # broadcast winner
            await self.channel_layer.group_send(self.group_name, {
                'type': 'announce.winner',
                'winner': result.get('player'),
                'index': result.get('index'),
                'pattern': result.get('pattern'),
                'row': result.get('row'),
                'col': result.get('col'),
                'picks': picks if isinstance(picks, (list, tuple)) else None,
            })
            # wait then restart
            await self._sleep(5)
            await self._restart_new_game()
            await self.channel_layer.group_send(self.group_name, {
                'type': 'game.restarted',
            })
        else:
            # disqualify this user only
            await self.send_json({'type': 'disqualified', 'reason': result.get('reason')})

    async def announce_winner(self, event):
        await self.send_json({
            'type': 'winner',
            'winner': event.get('winner'),
            'index': event.get('index'),
            'pattern': event.get('pattern'),
            'row': event.get('row'),
            'col': event.get('col'),
            'picks': event.get('picks'),
        })

    async def game_restarted(self, event):
        await self.send_json({'type': 'restarted'})

    async def finished(self, event):
        # No winner up to max calls; notify clients to reset/redirect
        await self.send_json({'type': 'finished'})

    async def call_sync(self, event):
        # Broadcast sync anchors so clients align their timers/audio
        await self.send_json({
            'type': 'call.sync',
            'started_at': event.get('started_at'),
            'server_time': event.get('server_time'),
        })

    async def _sleep(self, seconds: int):
        # simple asyncio sleep so we don't block
        import asyncio
        await asyncio.sleep(seconds)

    @database_sync_to_async
    def _award_and_finish_by_tid(self, tid: str):
        if not tid or not str(tid).isdigit():
            return None
        try:
            player = Player.objects.get(telegram_id=int(tid))
        except Player.DoesNotExist:
            return None
        game = Game.objects.filter(stake=self.stake, active=True).order_by('-id').first()
        if not game:
            return None
        with transaction.atomic():
            g = Game.objects.select_for_update().get(id=game.id)
            if g.finished:
                return None
            # compute pot based on charged_count snapshot when available
            accepted = g.selections.filter(accepted=True).count()
            charged = g.charged_count if getattr(g, 'stakes_charged', False) else accepted
            pot = (Decimal(charged) * Decimal(g.stake)) * Decimal('0.80')
            # credit winner and increment wins
            p = Player.objects.select_for_update().get(id=player.id)
            p.wallet = (p.wallet or Decimal('0')) + pot
            try:
                p.wins = (p.wins or 0) + 1
            except Exception:
                p.wins = (getattr(p, 'wins', 0) or 0) + 1
            p.save(update_fields=["wallet", "wins"]) 
            # record win payout transaction for reporting
            try:
                Transaction.objects.create(player=p, kind='other', amount=pot, note=f"Win pot for game {g.id}")
            except Exception:
                pass
            # deduct from losers only if not already charged at countdown
            if not getattr(g, 'stakes_charged', False):
                loser_ids = list(
                    g.selections.filter(accepted=True).exclude(player_id=p.id).values_list('player_id', flat=True)
                )
                if loser_ids:
                    losers = list(Player.objects.select_for_update().filter(id__in=loser_ids))
                    stake_dec = Decimal(g.stake)
                    for lp in losers:
                        current = lp.wallet or Decimal('0')
                        new_bal = current - stake_dec
                        if new_bal < Decimal('0'):
                            new_bal = Decimal('0')
                        if new_bal != current:
                            lp.wallet = new_bal
                            lp.save(update_fields=["wallet"]) 
            g.finished = True
            g.active = False
            g.save(update_fields=["finished","active"]) 
            return pot

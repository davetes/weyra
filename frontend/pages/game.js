import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { io } from "socket.io-client";

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
  const [totalGames, setTotalGames] = useState("-");
  const [currentCall, setCurrentCall] = useState(null);
  const [calledSet, setCalledSet] = useState(new Set());
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
  const gameStartedRef = useRef(false);
  const endRedirectTimeoutRef = useRef(null);
  const winnerSyncTimeoutRef = useRef(null);

  const lastPlayersRef = useRef(null);
  const lastAcceptedCardsRef = useRef(null);
  const lastTotalGamesRef = useRef(null);
  const lastStartedRef = useRef(null);
  const lastCurrentCallRef = useRef(null);
  const lastCalledSigRef = useRef("");
  const lastMyCardsSigRef = useRef("");
  const lastMyIndicesSigRef = useRef("");

  const derash = Math.max(0, acceptedCards * STAKE * 0.8);

  useEffect(() => {
    winnerRef.current = winner;
  }, [winner]);

  useEffect(() => {
    gameStartedRef.current = !!gameStarted;
  }, [gameStarted]);

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

      const nextTotalGames = data.total_games ?? "-";
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
          <div className="bg-rose-600 text-white font-semibold text-xs sm:text-sm px-3 py-2 rounded-lg shadow-lg">
            {toastMessage}
          </div>
        </div>
      )}

      <div className="w-full min-h-[100svh]">
        <div className="bg-slate-900 text-slate-100 px-2.5 py-2.5 sm:px-3 sm:py-3">
          <div className="flex items-center justify-end">
            <div className="w-6" />
          </div>
        </div>

        <div className="p-2.5 sm:p-3">
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-2.5 sm:p-3">
            <div className="grid grid-cols-5 gap-2 items-stretch">
              <div className="bg-teal-500/90 text-teal-950 ring-1 ring-teal-600/20 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm">
                Game ID: {totalGames}
              </div>
              <div className="bg-amber-500/90 text-amber-950 ring-1 ring-amber-600/20 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm">
                Bet: {STAKE} Birr
              </div>
              <div className="bg-emerald-500/90 text-emerald-950 ring-1 ring-emerald-600/20 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0">
                Derash: {Math.round(derash)} ETB
              </div>
              <div className="bg-slate-200/90 text-slate-900 ring-1 ring-slate-300 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0">
                Players: {players}
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
    transition-all duration-300 flex items-center justify-center rounded-xl px-3 py-2
    ${
      audioOn
        ? "bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] ring-2 ring-indigo-400"
        : "bg-slate-950 text-slate-200 ring-2 ring-slate-500 shadow-[0_0_12px_rgba(15,23,42,0.7)]"
    }
    active:scale-90 hover:scale-105
  `}
                aria-label={audioOn ? "Mute" : "Unmute"}
              >
                {audioOn ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-4 h-4 sm:w-5 sm:h-5"
                  >
                    <path d="M13.5 4.06c-.22-.02-.44.05-.61.22l-4 4H4.5c-.83 0-1.5.67-1.5 1.5v4.5c0 .83.67 1.5 1.5 1.5h4.39l4 4c.17.17.39.24.61.22.44-.03.75-.35.75-.78V4.84c0-.43-.31-.75-.75-.78zM18 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM15.5 3.12v2.06c2.89.86 5 3.54 5 6.82s-2.11 5.96-5 6.82v2.06c4-.9 7-4.51 7-8.88s-3-7.98-7-8.88z" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-4 h-4 sm:w-5 sm:h-5 opacity-60"
                  >
                    <path d="M3.28 2.22 2.22 3.28 7.44 8.5H4.5c-.83 0-1.5.67-1.5 1.5v4.5c0 .83.67 1.5 1.5 1.5h4.39l4 4c.17.17.39.24.61.22.44-.03.75-.35.75-.78V14.06l4.66 4.66c-.7.53-1.49.93-2.36 1.18v2.06c1.41-.33 2.69-.96 3.78-1.8l2.64 2.64 1.06-1.06L3.28 2.22zM15.5 3.12v2.06c1.35.4 2.53 1.14 3.46 2.11l-1.46 1.46c-.57-.61-1.25-1.08-2-1.37V3.12z" />
                  </svg>
                )}
              </button>
            </div>

            {/* dashboard */}
            <div className="mt-2.5 sm:mt-3 flex gap-2.5 sm:gap-3">
              <div className="flex-1">
                <div className="bg-gradient-to-b from-white to-slate-100 border border-slate-200 rounded-xl p-2">
                  <div className="grid grid-cols-5 gap-1">
                    {LETTERS.map((l) => (
                      <div
                        key={l}
                        className={`${LETTER_BG[l]} text-white font-extrabold text-center py-0.5 sm:py-1 rounded-md text-[10px] sm:text-xs`}
                      >
                        {l}
                      </div>
                    ))}
                  </div>

                  <div className="mt-1.5 grid grid-cols-5 gap-1">
                    {Array.from({ length: 15 }, (_, r) => r + 1).map((r) => (
                      <div key={r} className="contents">
                        {LETTERS.map((l, c) => {
                          const n = c * 15 + r;
                          const ns = String(n);
                          const isCurrent =
                            currentCall != null && ns === String(currentCall);
                          const isCalled = calledSet.has(ns) && !isCurrent;
                          const cellCls = isCurrent
                            ? "bg-amber-400 text-amber-950 border-amber-200"
                            : isCalled
                              ? "bg-sky-500 text-sky-950 border-sky-200"
                              : "bg-slate-900/40 text-slate-100 border-slate-700";

                          return (
                            <div
                              key={n}
                              className={`aspect-square rounded-md flex items-center justify-center font-bold text-[10px] sm:text-sm leading-none border ${cellCls}`}
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

              <div className="w-[168px] sm:w-[190px] space-y-2.5 sm:space-y-3">
                <div className="bg-black/60 border border-slate-700 rounded-xl px-2.5 py-3 sm:px-3 sm:py-3.5 flex items-center justify-center">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full blur-xl bg-amber-400/40" />
                    <div className="relative w-[88px] h-[88px] sm:w-[98px] sm:h-[98px] rounded-full bg-white border-[5px] border-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.55)] flex items-center justify-center">
                      <div className="text-2xl sm:text-[28px] font-black tracking-wide text-violet-700">
                        {currentCall != null
                          ? `${letterFor(currentCall)}-${currentCall}`
                          : "—"}
                      </div>
                    </div>
                  </div>
                </div>

                {gameStarted && !myCards?.[0] && !myCards?.[1] && (
                  <div className="border border-slate-700 rounded-xl p-3 sm:p-3.5 bg-indigo-950/30">
                    <div className="text-center text-slate-100 font-black text-lg sm:text-xl">
                      Watching Only
                    </div>
                    <div className="mt-6 text-center text-slate-200/90 text-sm leading-relaxed">
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
                      className={`border border-slate-700 rounded-xl p-1.5 sm:p-2 ${
                        activeSlot === slot
                          ? "bg-slate-950/40"
                          : "bg-slate-900/40"
                      }`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveSlot(slot)}
                      onKeyDown={() => setActiveSlot(slot)}
                    >
                      <div className="grid grid-cols-5 gap-1">
                        {LETTERS.map((l) => (
                          <div
                            key={l}
                            className={`${LETTER_BG[l]} text-white font-extrabold text-center py-0.5 sm:py-1 rounded-md text-[10px] sm:text-xs`}
                          >
                            {l}
                          </div>
                        ))}
                      </div>

                      <div className="mt-1.5 sm:mt-2 grid grid-cols-5 gap-1">
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
                              className={`rounded-sm sm:rounded-md aspect-square flex items-center justify-center font-bold border text-[10px] sm:text-sm leading-none select-none ${
                                isFree
                                  ? "bg-amber-400 text-amber-950 border-amber-200"
                                  : isPicked
                                    ? "bg-indigo-500 text-indigo-950 border-indigo-200"
                                    : "bg-teal-900/50 border-teal-700 text-teal-100"
                              }`}
                            >
                              {isFree ? "★" : val}
                            </div>
                          );
                        })}
                      </div>

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
                        className={`mt-2 flex items-center gap-2 px-2.5 py-1 rounded-full border transition-all ${
                          enabled ? "active:scale-95" : "opacity-50"
                        } ${
                          autoOn
                            ? "bg-emerald-500/10 border-emerald-500/40"
                            : "bg-slate-900/40 border-slate-700"
                        }`}
                      >
                        {/* Left Side: Labels */}
                        <div className="flex flex-col items-start leading-none pointer-events-none">
                          <span
                            className={`text-[9px] font-black uppercase tracking-tighter ${autoOn ? "text-emerald-400" : "text-slate-400"}`}
                          >
                            AUTO
                          </span>
                          <span className="text-[8px] font-medium opacity-60 text-slate-300">
                            ራስ-ሰር
                          </span>
                        </div>

                        {/* Right Side: The Toggle Switch */}
                        <div
                          className={`relative flex h-4 w-7 items-center rounded-full transition-colors duration-200 ${
                            autoOn ? "bg-emerald-500" : "bg-slate-600"
                          }`}
                        >
                          <div
                            className={`absolute h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                              autoOn ? "translate-x-3.5" : "translate-x-0.5"
                            }`}
                          />
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          claimBingo(slot);
                        }}
                        disabled={!enabled || !gameStarted}
                        className={`mt-2.5 sm:mt-3 w-full font-black rounded-lg py-2 sm:py-2.5 text-sm sm:text-base border-2 transition-all duration-150 uppercase tracking-widest ${
                          enabled && gameStarted
                            ? "bg-gradient-to-t from-yellow-600 to-yellow-400 text-yellow-950 border-yellow-300 shadow-[0_0_15px_rgba(250,204,21,0.4)] active:scale-[0.96] animate-pulse"
                            : "bg-slate-800/50 text-slate-500 border-slate-700 opacity-60 cursor-not-allowed"
                        }`}
                      >
                        <div className="flex flex-col leading-none">
                          <span>BINGO!</span>
                          <span className="text-[9px] sm:text-[10px] mt-1 opacity-80">
                            ድልዎን ያውጁ
                          </span>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Winner Modal */}
      {winner && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[9999] animate-in fade-in duration-300">
          <div className="bg-slate-900 border-2 border-indigo-500/50 rounded-[24px] shadow-[0_0_50px_rgba(79,70,229,0.4)] p-4 max-w-[500px] w-[95vw] overflow-hidden">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 text-white font-black text-center rounded-xl py-3 mb-4 text-3xl tracking-widest shadow-lg animate-bounce">
              BINGO!
            </div>

            {/* Winner Name Section */}
            <div className="flex flex-col items-center gap-1 justify-center my-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🏆</span>
                <span className="bg-gradient-to-b from-amber-200 to-amber-500 bg-clip-text text-transparent font-black text-2xl uppercase tracking-tighter">
                  {winner.name}
                </span>
                <span className="text-2xl">🏆</span>
              </div>
              <span className="text-slate-400 font-medium text-sm">
                HAS WON THE GAME
              </span>
            </div>

            {/* The Winning Card Container */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-3 my-2 shadow-inner">
              {/* B-I-N-G-O Letters */}
              <div className="grid grid-cols-5 gap-2 mb-2">
                {LETTERS.map((l) => (
                  <div
                    key={l}
                    className={`${LETTER_BG[l]} text-white font-black text-center rounded-lg aspect-square flex items-center justify-center text-sm shadow-md`}
                  >
                    {l}
                  </div>
                ))}
              </div>

              {/* The Card Grid */}
              <div className="bg-slate-950/50 rounded-xl p-2 grid grid-cols-5 gap-2 border border-slate-800">
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
                        className={`relative rounded-lg aspect-square flex items-center justify-center font-black border-2 text-xs sm:text-sm transition-all
                  ${
                    isWin
                      ? "bg-indigo-500 border-indigo-300 text-white shadow-[0_0_15px_rgba(99,102,241,0.6)] z-10 scale-105"
                      : isP
                        ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                        : isFree
                          ? "bg-amber-500 border-amber-300 text-white animate-pulse"
                          : "bg-slate-800/50 border-slate-700 text-slate-500 opacity-40"
                  }`}
                      >
                        {isFree ? "⭐" : val}
                      </div>
                    );
                  })}
              </div>

              {/* Info Text */}
              <div className="flex justify-between items-center mt-3 px-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  Board #{winner.index}
                </span>
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                </div>
              </div>
            </div>

            {/* Numbers List */}
            <div className="mt-3 p-2 bg-slate-950/30 rounded-lg text-center">
              <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">
                Winning Sequence
              </p>
              <div className="text-[11px] sm:text-xs text-indigo-300 font-mono break-all leading-tight">
                {winnerPickList.length ? winnerPickList.join(" • ") : "—"}
              </div>
            </div>

            {/* Countdown Footer */}
            <div className="relative mt-4 flex items-center justify-center">
              <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full"></div>
              <div className="relative bg-slate-950 border border-indigo-500/30 text-indigo-400 w-12 h-12 flex items-center justify-center rounded-full font-black text-xl shadow-xl">
                {winner.countdown ?? 5}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

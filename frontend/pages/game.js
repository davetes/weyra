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
  const [totalGames, setTotalGames] = useState("-");
  const [currentCall, setCurrentCall] = useState(null);
  const [calledSet, setCalledSet] = useState(new Set());
  const [myCards, setMyCards] = useState([null, null]);
  const [myIndices, setMyIndices] = useState([null, null]);
  const [activeSlot, setActiveSlot] = useState(0);
  const [picks0, setPicks0] = useState(new Set());
  const [picks1, setPicks1] = useState(new Set());
  const [winner, setWinner] = useState(null);
  const [audioOn, setAudioOn] = useState(false);
  const [suppressCalls, setSuppressCalls] = useState(false);

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

  const derash = Math.max(0, players * STAKE * 0.8);

  useEffect(() => {
    winnerRef.current = winner;
  }, [winner]);

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

  useEffect(() => {
    const idx0 = myIndices?.[0] != null ? Number(myIndices[0]) : null;
    const idx1 = myIndices?.[1] != null ? Number(myIndices[1]) : null;
    setPicks0(loadSlotPicks(0, idx0));
    setPicks1(loadSlotPicks(1, idx1));
  }, [STAKE, myIndices]);

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

  const refresh = useCallback(async () => {
    if (!TID) return;
    try {
      const res = await fetch(
        `/api/game_state?stake=${STAKE}&tid=${encodeURIComponent(TID)}`,
      );
      if (!res.ok) return;
      const data = await res.json();

      if (typeof data.server_time === "number") {
        const offset = data.server_time - Date.now();
        serverOffsetRef.current = serverOffsetRef.current * 0.8 + offset * 0.2;
      }

      setPlayers(data.players ?? 0);
      setTotalGames(data.total_games ?? "-");

      if (
        data.current_call != null &&
        String(data.current_call) !== lastAudioCallRef.current
      ) {
        playNumber(data.current_call);
      }
      setCurrentCall(data.current_call);

      if (audioOn && data.current_call != null)
        preloadNextNumbers(data.current_call);

      const called = new Set((data.called_numbers || []).map(String));
      if (data.current_call != null) called.add(String(data.current_call));
      setCalledSet(called);

      if (Array.isArray(data.my_cards)) setMyCards(data.my_cards);
      if (Array.isArray(data.my_indices)) setMyIndices(data.my_indices);

      const callNum =
        data.current_call != null ? Number(data.current_call) : null;
      const calledCount = Array.isArray(data.called_numbers)
        ? data.called_numbers.length
        : 0;
      const noWinner = !winnerRef.current && !suppressCalls;

      if (
        noWinner &&
        !noWinnerRedirectedRef.current &&
        callNum != null &&
        Number.isFinite(callNum) &&
        callNum >= 75 &&
        calledCount >= 75
      ) {
        noWinnerRedirectedRef.current = true;
        router.push(`/play?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
      }
    } catch (_) {}
  }, [STAKE, TID, suppressCalls, audioOn]);

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
        showWinner(msg.winner, msg.index, msg);
      } else if (
        msg.type === "restarted" ||
        msg.type === "finished" ||
        msg.type === "disqualified"
      ) {
        try {
          localStorage.clear();
        } catch (_) {}
        router.push(`/play?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
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
    setWinner({ name: name || "Player", index, details, countdown: 5 });
    let left = 5;
    if (winCountdownRef.current) clearInterval(winCountdownRef.current);
    winCountdownRef.current = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(winCountdownRef.current);
        try {
          localStorage.clear();
        } catch (_) {}
        router.push(`/play?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
      }
      setWinner((prev) =>
        prev ? { ...prev, countdown: Math.max(0, left) } : null,
      );
    }, 1000);
  }

  function claimBingo(slot) {
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
      .then((r) => r.json())
      .then((data) => {
        const idx = myIndices?.[slot ?? 0];
        if (data.ok && idx != null) showWinner("You", idx, data);
      })
      .catch(() => {});
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

  function leaveGame() {
    router.push(`/play?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
  }

  return (
    <>
      <Head>
        <title>Bingo - Game</title>
      </Head>
      <audio ref={audioRef} preload="auto" />

      <div className="max-w-[480px] mx-auto min-h-[100svh]">
        <div className="bg-slate-900 text-slate-100 px-2.5 py-2.5 sm:px-3 sm:py-3">
          <div className="flex items-center justify-end">
            <div className="w-6" />
          </div>
        </div>

        <div className="p-2.5 sm:p-3">
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-2.5 sm:p-3">
            <div className="grid grid-cols-5 gap-2 items-stretch">
              <div className="bg-teal-500/90 text-teal-950 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0">
                Game Id #{totalGames}
              </div>
              <div className="bg-emerald-500/90 text-emerald-950 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0">
                Stake Birr {STAKE}
              </div>
              <div className="bg-pink-500/90 text-pink-950 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0">
                Prize Birr {Math.round(derash)}
              </div>
              <div className="bg-amber-400/95 text-amber-950 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0">
                Players {players}
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
                className="bg-amber-400/95 text-amber-950 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs flex items-center justify-center"
                aria-label={audioOn ? "Mute" : "Unmute"}
              >
                {audioOn ? (
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M4 9v6h4l5 4V5L8 9H4z" />
                    <path d="M16.5 12c0-1.4-.5-2.7-1.4-3.7l1.4-1.4A7.48 7.48 0 0 1 19 12a7.48 7.48 0 0 1-2.5 5.6l-1.4-1.4c.9-1 1.4-2.3 1.4-3.7z" />
                    <path d="M14.3 9.7 12.9 11.1a1.97 1.97 0 0 1 0 1.8l1.4 1.4a3.97 3.97 0 0 0 0-4.6z" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M16.5 12c0-1.4-.5-2.7-1.4-3.7l1.4-1.4A7.48 7.48 0 0 1 19 12a7.48 7.48 0 0 1-2.5 5.6l-1.4-1.4c.9-1 1.4-2.3 1.4-3.7z" />
                    <path d="M14.3 9.7 12.9 11.1a1.97 1.97 0 0 1 0 1.8l1.4 1.4a3.97 3.97 0 0 0 0-4.6z" />
                    <path d="M4 9v6h4l5 4V5L8 9H4z" />
                    <path d="m3 3 18 18-1.4 1.4L2 4.4 3 3z" />
                  </svg>
                )}
              </button>
            </div>

            <div className="mt-2.5 sm:mt-3 flex gap-2.5 sm:gap-3">
              <div className="flex-1">
                <div className="bg-slate-900/70 border border-slate-700 rounded-xl p-2">
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
                            ? "bg-emerald-500 text-emerald-950 border-emerald-300"
                            : isCalled
                              ? "bg-pink-500 text-pink-950 border-pink-300"
                              : "bg-slate-950/30 text-slate-100 border-slate-700";

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

              <div className="w-[168px] sm:w-[190px] space-y-2.5 sm:space-y-3">
                <div className="bg-black/60 border border-slate-700 rounded-xl px-2.5 py-2.5 sm:px-3 sm:py-3 flex items-center justify-center">
                  <div className="text-2xl sm:text-3xl font-black tracking-wide animate-bounce text-shadow-glow">
                    {currentCall != null
                      ? `${letterFor(currentCall)}-${currentCall}`
                      : "—"}
                  </div>
                </div>

                {[0, 1].map((slot) => {
                  const card = myCards?.[slot] || null;
                  const slotPicks = slot === 1 ? picks1 : picks0;
                  const enabled = !!card;

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
                      <div className="mt-1.5 sm:mt-2 grid grid-cols-5 gap-1">
                        {card ? (
                          card.flat().map((val, i) => {
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
                          })
                        ) : (
                          <div className="col-span-5 text-center text-slate-400 py-3 text-[11px] sm:text-sm">
                            No card
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          claimBingo(slot);
                        }}
                        disabled={!enabled}
                        className={`mt-2.5 sm:mt-3 w-full bg-amber-700/90 text-amber-100 font-black rounded-lg py-1.5 sm:py-2 text-xs sm:text-sm border border-amber-500 ${
                          enabled ? "active:scale-[0.99]" : "opacity-60"
                        }`}
                      >
                        BINGO
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={leaveGame}
              className="mt-3.5 sm:mt-4 w-full bg-red-600 text-white font-bold rounded-xl py-2.5 sm:py-3 text-sm"
            >
              Leave Game
            </button>
          </div>
        </div>
      </div>

      {/* Winner Modal */}
      {winner && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
          <div className="bg-[#ede3f6] rounded-[14px] shadow-2xl p-3 max-w-[520px] w-[95vw]">
            <div className="bg-accent text-white font-black text-center rounded-[10px] py-2.5 mb-2.5 text-xl">
              BINGO!
            </div>
            <div className="flex items-center gap-2 justify-center my-2">
              <span className="bg-green-bingo text-[#0b3018] font-extrabold rounded-lg px-2 py-0.5">
                {winner.name}
              </span>
              <span className="text-gray-700">has won the game</span>
            </div>
            <div className="bg-[#d8c9ef] rounded-xl p-2 my-2">
              <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                {LETTERS.map((l) => (
                  <div
                    key={l}
                    className={`${LETTER_BG[l]} text-white font-extrabold text-center rounded-md aspect-square flex items-center justify-center text-[11px] sm:text-sm leading-none`}
                  >
                    {l}
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-[10px] p-2.5 grid grid-cols-5 gap-2">
                {winCardRows &&
                  winCardRows.flat().map((val, i) => {
                    const r = Math.floor(i / 5),
                      c = i % 5;
                    const isFree = val === "FREE";
                    const isWin = isWinningCell(r, c, winner.details);
                    const winPicks = winner.details?.picks
                      ? new Set(winner.details.picks.map(String))
                      : picks;
                    const isP = !isFree && winPicks.has(String(val));
                    return (
                      <div
                        key={i}
                        className={`rounded-sm sm:rounded-md aspect-square flex items-center justify-center font-bold border text-[11px] sm:text-sm leading-none
                      ${
                        isWin
                          ? "bg-indigo-500 text-indigo-950 border-indigo-200"
                          : isP
                            ? "bg-emerald-500 text-emerald-950 border-emerald-200"
                            : isFree
                              ? "bg-amber-400 text-amber-950 border-amber-200"
                              : "bg-teal-900/50 border-teal-700 text-teal-100"
                      }`}
                      >
                        {isFree ? "⭐" : val}
                      </div>
                    );
                  })}
              </div>
              <div className="text-center mt-1.5 font-bold text-gray-700">
                Board number {winner.index}
              </div>
            </div>
            <div className="bg-accent text-white text-center font-black rounded-[10px] py-2.5 mt-2 text-xl">
              {winner.countdown ?? 5}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

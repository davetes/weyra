import Link from "next/link";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { ArrowLeftFromLine } from "lucide-react";

/* ── Deterministic card generator (same as server/utils.js) ── */
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
const RANGES = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];

function buildCard(seed) {
  const cols = RANGES.map(([s, e], idx) => {
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

const LETTER_BG = {
  B: "bg-green-bingo",
  I: "bg-red-bingo",
  N: "bg-yellow-bingo",
  G: "bg-blue-bingo",
  O: "bg-pink-bingo",
};
const LETTERS = ["B", "I", "N", "G", "O"];
const NUMBERS = Array.from({ length: 200 }, (_, i) => i + 1);

/* ── Memoized grid cell to avoid re-rendering all 200 on every state update ── */
const GridCell = React.memo(function GridCell({ n, isTaken, isSelected, onClick }) {
  const base =
    "relative font-black rounded sm:rounded aspect-square flex items-center justify-center select-none text-sm sm:text-lg leading-none border-2 transition-colors duration-150";
  const cls = isSelected
    ? "bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 border-amber-300 text-white shadow-lg shadow-amber-500/30"
    : isTaken
      ? "bg-gradient-to-br from-rose-500 via-rose-600 to-red-600 border-rose-300 text-white shadow-sm"
      : "bg-emerald-900/40 border-emerald-500/30 text-emerald-100 shadow-sm hover:bg-emerald-800/50 active:scale-95";

  return (
    <button
      type="button"
      className={`${base} ${cls}`}
      disabled={isTaken && !isSelected}
      onClick={onClick}
    >
      {n}
      {isSelected && (
        <span className="absolute top-0.5 right-0.5 w-4 h-4 sm:w-5 sm:h-5 bg-white/90 rounded-full flex items-center justify-center text-[8px] sm:text-[10px] text-purple-600 font-black shadow-md">
          ✓
        </span>
      )}
    </button>
  );
});

export default function PlayPage() {
  const router = useRouter();
  const { stake: stakeQ, tid: tidQ } = router.query;
  const STAKE = parseInt(stakeQ || "10", 10);
  const TID = tidQ || "";

  const [splashVisible, setSplashVisible] = useState(false);
  const [splashError, setSplashError] = useState("");
  const [taken, setTaken] = useState(new Set());
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [acceptedCards, setAcceptedCards] = useState(0);
  const [gameId, setGameId] = useState("-");
  const [wallet, setWallet] = useState(0);
  const [gift, setGift] = useState(0);
  const [countdown, setCountdown] = useState("-");
  const [selectedA, setSelectedA] = useState(null);
  const [selectedB, setSelectedB] = useState(null);
  const [activeSlot, setActiveSlot] = useState(0);
  const [showInsufficient, setShowInsufficient] = useState(false);
  const [insufficientNeed, setInsufficientNeed] = useState(0);

  const countdownTimerRef = useRef(null);
  const pollRef = useRef(null);
  const pushedToGameRef = useRef(false);
  const firstLoad = useRef(true);
  const lastPlayState = useRef({});
  const lastTakenSigRef = useRef("");
  const pendingActionRef = useRef(0); // guards against polling overwriting optimistic selection

  /* ── Refs to hold latest state values so refreshState callback stays stable ── */
  const acceptedCountRef = useRef(acceptedCount);
  const acceptedCardsRef = useRef(acceptedCards);
  const gameIdRef = useRef(gameId);
  const walletRef = useRef(wallet);
  const giftRef = useRef(gift);
  useEffect(() => { acceptedCountRef.current = acceptedCount; }, [acceptedCount]);
  useEffect(() => { acceptedCardsRef.current = acceptedCards; }, [acceptedCards]);
  useEffect(() => { gameIdRef.current = gameId; }, [gameId]);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);
  useEffect(() => { giftRef.current = gift; }, [gift]);

  async function acceptCard(index, slot) {
    if (!TID || !index) return;
    pendingActionRef.current++;
    try {
      const form = new URLSearchParams();
      form.set("tid", String(TID));
      form.set("stake", String(STAKE));
      form.set("index", String(index));
      form.set("slot", String(slot ?? 0));
      form.set("action", "accept");
      const res = await fetch("/api/select", { method: "POST", body: form });

      if (res.ok) {
        const data = await res.json();
        setTaken(new Set((data.taken || []).map(String)));
        setAcceptedCount(data.accepted_count || 0);
        return;
      }

      if (res.status === 409) {
        alert("This card has just been taken by another player.");
        await refreshState();
        return;
      }

      let msg = "Failed";
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch (_) { }
      alert(msg);
      await refreshState();
    } finally {
      pendingActionRef.current--;
    }
  }

  async function cancelCard(slot, index) {
    if (!TID) return;
    pendingActionRef.current++;
    try {
      if (index != null) {
        setTaken((prev) => {
          const next = new Set(prev);
          next.delete(String(index));
          return next;
        });
      }
      const form = new URLSearchParams();
      form.set("tid", String(TID));
      form.set("stake", String(STAKE));
      form.set("slot", String(slot ?? 0));
      form.set("action", "cancel");
      await fetch("/api/select", { method: "POST", body: form }).catch(() => { });
      await refreshState();
    } finally {
      pendingActionRef.current--;
    }
  }

  const refreshState = useCallback(async () => {
    if (!TID) {
      setSplashError("Missing player id.");
      setSplashVisible(false);
      return;
    }
    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(
        `/api/game_state?stake=${STAKE}&tid=${encodeURIComponent(TID)}`,
        { signal: controller.signal },
      );
      clearTimeout(to);
      if (!res.ok) {
        setSplashError("Server unavailable. Try again.");
        setSplashVisible(false);
        return;
      }
      const data = await res.json();
      setSplashError("");

      lastPlayState.current = data;

      if (
        firstLoad.current &&
        data.my_indices != null &&
        !data.countdown_started_at &&
        !data.started
      ) {
        try {
          await fetch("/api/abandon", {
            method: "POST",
            body: `tid=${encodeURIComponent(TID)}&stake=${STAKE}`,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          });
        } catch (_) { }
        firstLoad.current = false;
        return refreshState();
      }
      firstLoad.current = false;

      const nextGameId = data.game_id ?? "-";
      if (nextGameId !== gameIdRef.current) setGameId(nextGameId);

      const takenArr = (data.taken || []).map(String);
      takenArr.sort((a, b) => Number(a) - Number(b));
      const takenSig = takenArr.join(",");
      if (takenSig !== lastTakenSigRef.current) {
        lastTakenSigRef.current = takenSig;
        setTaken(new Set(takenArr));
      }

      const nextAccepted = data.accepted_count || 0;
      if (nextAccepted !== acceptedCountRef.current) setAcceptedCount(nextAccepted);

      const nextAcceptedCards = data.accepted_cards || 0;
      if (nextAcceptedCards !== acceptedCardsRef.current)
        setAcceptedCards(nextAcceptedCards);
      if (Array.isArray(data.my_indices) && !data.started && pendingActionRef.current === 0) {
        const a =
          data.my_indices[0] != null ? Number(data.my_indices[0]) : null;
        const b =
          data.my_indices[1] != null ? Number(data.my_indices[1]) : null;
        setSelectedA(Number.isFinite(a) && a > 0 ? a : null);
        setSelectedB(Number.isFinite(b) && b > 0 ? b : null);
      }
      if (typeof data.wallet === "number" && data.wallet !== walletRef.current)
        setWallet(data.wallet);
      if (typeof data.gift === "number" && data.gift !== giftRef.current)
        setGift(data.gift);

      const remaining = data.countdown_remaining;
      if (typeof remaining === "number") {
        // Just use server's countdown value directly - no local timer needed
        if (remaining <= 0) setCountdown("Starting...");
        else setCountdown(String(remaining));
      } else {
        if (!data.started) setCountdown("-");
      }

      if (!data.started) {
        pushedToGameRef.current = false;
      }

      if (data.started && !pushedToGameRef.current) {
        pushedToGameRef.current = true;
        router.push(`/game?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
      }

      setSplashVisible(false);
    } catch (err) {
      const isAbort =
        err &&
        (err.name === "AbortError" ||
          String(err.message || "").includes("aborted"));
      setSplashError(
        isAbort ? "Server timeout. Try again." : "Network error. Try again.",
      );
      setSplashVisible(false);
    }
  }, [STAKE, TID, router]);

  function startCountdown(iso, initialRemaining = 30) {
    const start = new Date(iso).getTime();
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const rem = Math.max(0, initialRemaining - elapsed);
      setCountdown(rem <= 0 ? "Starting..." : String(rem));
      if (rem <= 0) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    }, 1000);
    // Set initial value immediately
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const rem = Math.max(0, initialRemaining - elapsed);
    setCountdown(rem <= 0 ? "Starting..." : String(rem));
  }

  function startCountdownFromRemaining(remainingSeconds) {
    let rem = Math.max(0, Math.floor(Number(remainingSeconds) || 0));
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    setCountdown(rem <= 0 ? "Starting..." : String(rem));
    countdownTimerRef.current = setInterval(() => {
      rem = Math.max(0, rem - 1);
      setCountdown(rem <= 0 ? "Starting..." : String(rem));
      if (rem <= 0) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    }, 1000);
  }

  useEffect(() => {
    if (!router.isReady) return;
    // Prefetch homepage for faster navigation back
    router.prefetch("/");
    refreshState();
    pollRef.current = setInterval(refreshState, 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [router.isReady, refreshState]);

  useEffect(() => {
    const handle = () => {
      const s = lastPlayState.current;
      if (s.my_indices != null && !s.countdown_started_at && !s.started) {
        const payload = `tid=${encodeURIComponent(TID)}&stake=${STAKE}`;
        navigator.sendBeacon(
          "/api/abandon",
          new Blob([payload], { type: "application/x-www-form-urlencoded" }),
        );
      }
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [TID, STAKE]);

  const derash = Math.max(0, acceptedCards * STAKE * 0.8);
  const cardRowsA = selectedA ? buildCard(selectedA) : null;
  const cardRowsB = selectedB ? buildCard(selectedB) : null;
  const totalBalance = wallet + gift;
  const selectedCount = (selectedA ? 1 : 0) + (selectedB ? 1 : 0);
  const selectedCost = selectedCount * STAKE;
  const remainingBalance = Math.max(0, totalBalance - selectedCost);
  const startsInText =
    countdown === "-"
      ? "--"
      : countdown === "Starting..."
        ? "00"
        : `${String(countdown).padStart(2, "0")}`;

  return (
    <>
      <Head>
        <title>Bingo</title>
      </Head>

      {splashVisible && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-300 font-extrabold text-base transition-opacity duration-300">
          <div className="flex flex-col items-center gap-4">
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-3 h-3 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 animate-pulse3"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <div className="text-slate-400 tracking-wide">Loading...</div>
          </div>
        </div>
      )}

      {splashError && (
        <div className="mx-auto max-w-[420px] px-2.5 sm:px-3 pt-3">
          <div className="bg-gradient-to-r from-amber-500/90 to-orange-500/90 text-amber-950 border border-amber-400/50 rounded-xl px-4 py-3 text-xs sm:text-sm font-bold flex items-center justify-between gap-3 shadow-lg shadow-amber-500/20">
            <span>{splashError}</span>
            <button
              type="button"
              onClick={refreshState}
              className="bg-amber-950/90 text-amber-100 font-bold rounded-lg px-4 py-1.5 hover:bg-amber-900 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="fixed inset-0 w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col overflow-hidden">
        <div className="bg-gradient-to-r from-slate-900/95 via-slate-800/95 to-slate-900/95 backdrop-blur-xl text-slate-100 px-1.5 py-1.5 sm:px-2 sm:py-2 border-b border-white/5 flex-none">
          {countdown !== "-" && (
            <div className="mb-1.5 flex justify-center gap-2 flex-wrap">
              <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border-2 border-slate-700/80 rounded-[100%] px-3 py-2 sm:px-4 sm:py-2.5 shadow-xl flex items-center justify-center gap-2">
                <span className="text-xl sm:text-2xl font-black text-slate-200">
                  {startsInText}s
                </span>
              </div>
              {acceptedCount >= 2 && (
                <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border-2 border-slate-700/80 rounded-none px-3 py-2 sm:px-4 sm:py-2.5 shadow-xl flex items-center justify-center gap-2">
                  <span className="text-xs sm:text-sm text-slate-400 font-medium">
                    Derash
                  </span>
                  <span className="text-xl sm:text-2xl font-black text-slate-200">
                    {Math.round(derash)} ETB
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-5 gap-1.5 sm:gap-2 items-stretch ">
            <Link
              href={TID ? `/?tid=${encodeURIComponent(TID)}` : "/"}
              prefetch={true}
              scroll={false}
              className="text-slate-100 font-bold rounded-none px-1.5 py-1.5 sm:px-2 sm:py-1.5 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm cursor-pointer"
            >
              <span className="opacity-70 flex items-center justify-center gap-1  px-1 rounded ">
                <ArrowLeftFromLine className="font-serif font-bold mt-1  w-6 h-6" />
              </span>
            </Link>
            <div className="bg-white/10 backdrop-blur-md border border-white/20 text-white font-bold rounded-none px-1.5 py-1.5 sm:px-2 sm:py-1.5 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm">
              <span className="opacity-70">Game ID:</span>
              <br />
              <span className="text-sm sm:text-base">{gameId}</span>
            </div>
            <div className="bg-amber-500/20 backdrop-blur-md border border-amber-400/30 text-amber-300 font-bold rounded-none px-1.5 py-1.5 sm:px-2 sm:py-1.5 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm">
              <span className="opacity-70">Bet:</span>
              <br />
              <span className="text-sm sm:text-base">{STAKE} Birr</span>
            </div>
            <div className="bg-emerald-500/20 backdrop-blur-md border border-emerald-400/30 text-emerald-300 font-bold rounded-none px-1.5 py-1.5 sm:px-2 sm:py-1.5 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm">
              <span className="opacity-80">Main Wallet:</span>
              <br />
              <span className="text-sm sm:text-base">
                {Number(wallet || 0).toFixed(2)}
              </span>
            </div>
            <div className="bg-cyan-500/20 backdrop-blur-md border border-slate-400/30 text-cyan-300 font-bold rounded-none px-1.5 py-1.5 sm:px-2 sm:py-1.5 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 shadow-sm">
              <span className="opacity-80">play wallet:</span>
              <br />
              <span className="text-sm sm:text-base">
                {Number(gift || 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5 sm:py-2">
          <div className="bg-gradient-to-br from-slate-800/90 via-slate-800/80 to-slate-900/90 border-y border-white/10 py-1.5 sm:py-2 shadow-xl h-full flex flex-col border-l border-r border-slate-600/30">
            <div className="flex-1 overflow-y-auto no-scrollbar px-2" style={{ willChange: 'transform', WebkitOverflowScrolling: 'touch', contentVisibility: 'auto', containIntrinsicSize: 'auto 2000px' }}>
              <div className="grid grid-cols-8 gap-1 sm:gap-1.5">
                {NUMBERS.map((n) => {
                  const key = String(n);
                  const isTaken = taken.has(key);
                  const isSelected = selectedA === n || selectedB === n;

                  return (
                    <GridCell
                      key={n}
                      n={n}
                      isTaken={isTaken}
                      isSelected={isSelected}
                      onClick={() => {
                        if (selectedA === n) {
                          cancelCard(0, n);
                          setSelectedA(null);
                          return;
                        }
                        if (selectedB === n) {
                          cancelCard(1, n);
                          setSelectedB(null);
                          return;
                        }

                        const bal = wallet + gift;
                        const currentSelectedCount =
                          (selectedA ? 1 : 0) + (selectedB ? 1 : 0);
                        const nextCost = (currentSelectedCount + 1) * STAKE;
                        if (bal < nextCost) {
                          setInsufficientNeed(Math.max(0, nextCost - bal));
                          setShowInsufficient(true);
                          return;
                        }
                        setShowInsufficient(false);

                        if (!selectedA) {
                          setSelectedA(n);
                          acceptCard(n, 0);
                          return;
                        }

                        if (!selectedB) {
                          setSelectedB(n);
                          acceptCard(n, 1);
                          return;
                        }

                        cancelCard(1, selectedB);
                        setSelectedB(n);
                        acceptCard(n, 1);
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {showInsufficient && (
              <div className="mt-2 bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 border border-amber-400/40 text-amber-200 rounded-lg px-2 py-1.5 text-center text-[10px] sm:text-xs font-bold backdrop-blur-sm flex-none">
                <span className="mr-1">⚠️</span>Insufficient Funds - (
                {Number(insufficientNeed || 0).toFixed(2)} Birr)
              </div>
            )}

            {(selectedA || selectedB) && (
              <div className="mt-2 grid grid-cols-2 gap-1 sm:gap-1.5 flex-none">
                <div
                  className={`border-2 rounded-none p-1.5 sm:p-2 transition-all duration-300 ${activeSlot === 0
                      ? "bg-gradient-to-br from-indigo-950/80 via-slate-900/80 to-purple-950/80 border-indigo-400/60 shadow-lg shadow-indigo-500/20"
                      : "bg-gradient-to-br from-slate-900/70 via-slate-900/60 to-slate-800/70 border-slate-600/40"
                    }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveSlot(0)}
                  onKeyDown={() => setActiveSlot(0)}
                >
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

                  <div className="mt-1 sm:mt-1.5 grid grid-cols-5 gap-1 sm:gap-1.5">
                    {cardRowsA &&
                      cardRowsA.flat().map((val, i) => (
                        <div
                          key={i}
                          className={`rounded-none aspect-square flex items-center justify-center font-black border text-sm sm:text-base leading-none transition-all ${val === "FREE"
                              ? "bg-gradient-to-br from-amber-400 to-amber-500 border-amber-300 text-amber-900 shadow-sm shadow-amber-400/30"
                              : "bg-gradient-to-br from-teal-800/70 to-teal-900/80 border-teal-500/40 text-white"
                            }`}
                        >
                          {val === "FREE" ? "★" : val}
                        </div>
                      ))}
                  </div>
                </div>

                {selectedB ? (
                  <div
                    className={`border-2 rounded-none p-1.5 sm:p-2 transition-all duration-300 ${activeSlot === 1
                        ? "bg-gradient-to-br from-indigo-950/80 via-slate-900/80 to-purple-950/80 border-indigo-400/60 shadow-lg shadow-indigo-500/20"
                        : "bg-gradient-to-br from-slate-900/70 via-slate-900/60 to-slate-800/70 border-slate-600/40"
                      }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveSlot(1)}
                    onKeyDown={() => setActiveSlot(1)}
                  >
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

                    <div className="mt-1 sm:mt-1.5 grid grid-cols-5 gap-1 sm:gap-1.5">
                      {cardRowsB &&
                        cardRowsB.flat().map((val, i) => (
                          <div
                            key={i}
                            className={`rounded-none aspect-square flex items-center justify-center font-black border text-sm sm:text-base leading-none transition-all ${val === "FREE"
                                ? "bg-gradient-to-br from-amber-400 to-amber-500 border-amber-300 text-amber-900 shadow-sm shadow-amber-400/30"
                                : "bg-gradient-to-br from-teal-800/70 to-teal-900/80 border-teal-500/40 text-white"
                              }`}
                          >
                            {val === "FREE" ? "★" : val}
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-slate-500/50 rounded-none p-2 bg-gradient-to-br from-slate-900/40 to-slate-800/40 flex items-center justify-center text-center backdrop-blur-sm">
                    <div className="text-[10px] text-slate-400 leading-tight">
                      <span className="text-sm mb-1 block">➕</span>
                      Select 2nd card
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="text-slate-500 text-[8px] text-center py-1 font-medium tracking-wider flex-none">
          Copyright © 2026. All rights reserved.
        </div>
      </div>
    </>
  );
}

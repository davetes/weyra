import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";

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

export default function PlayPage() {
  const router = useRouter();
  const { stake: stakeQ, tid: tidQ } = router.query;
  const STAKE = parseInt(stakeQ || "10", 10);
  const TID = tidQ || "";

  const [splashVisible, setSplashVisible] = useState(false);
  const [splashError, setSplashError] = useState("");
  const [taken, setTaken] = useState(new Set());
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [totalGames, setTotalGames] = useState("-");
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
  const firstLoad = useRef(true);
  const lastPlayState = useRef({});
  const lastTakenSigRef = useRef("");

  const numbers = Array.from({ length: 200 }, (_, i) => i + 1);

  async function acceptCard(index, slot) {
    if (!TID || !index) return;
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
      if (data.countdown_started_at) startCountdown(data.countdown_started_at);
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
    } catch (_) {}
    alert(msg);
    await refreshState();
  }

  async function cancelCard(slot, index) {
    if (!TID) return;
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
    await fetch("/api/select", { method: "POST", body: form }).catch(() => {});
    await refreshState();
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
        } catch (_) {}
        firstLoad.current = false;
        return refreshState();
      }
      firstLoad.current = false;

      const nextTotalGames = data.total_games ?? "-";
      if (nextTotalGames !== totalGames) setTotalGames(nextTotalGames);

      const takenArr = (data.taken || []).map(String);
      takenArr.sort((a, b) => Number(a) - Number(b));
      const takenSig = takenArr.join(",");
      if (takenSig !== lastTakenSigRef.current) {
        lastTakenSigRef.current = takenSig;
        setTaken(new Set(takenArr));
      }

      const nextAccepted = data.accepted_count || 0;
      if (nextAccepted !== acceptedCount) setAcceptedCount(nextAccepted);
      if (Array.isArray(data.my_indices) && !data.started) {
        const a =
          data.my_indices[0] != null ? Number(data.my_indices[0]) : null;
        const b =
          data.my_indices[1] != null ? Number(data.my_indices[1]) : null;
        setSelectedA(Number.isFinite(a) && a > 0 ? a : null);
        setSelectedB(Number.isFinite(b) && b > 0 ? b : null);
      }
      if (typeof data.wallet === "number" && data.wallet !== wallet)
        setWallet(data.wallet);
      if (typeof data.gift === "number" && data.gift !== gift) setGift(data.gift);

      if (data.countdown_started_at && !countdownTimerRef.current) {
        startCountdown(data.countdown_started_at);
      }
      if (data.started) {
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
  }, [STAKE, TID, router, acceptedCount, gift, totalGames, wallet]);

  function startCountdown(iso) {
    const start = new Date(iso).getTime();
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      const rem = Math.max(0, 30 - Math.floor((Date.now() - start) / 1000));
      setCountdown(rem <= 0 ? "Starting..." : String(rem));
      if (rem <= 0) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    }, 500);
  }

  useEffect(() => {
    if (!router.isReady) return;
    refreshState();
    pollRef.current = setInterval(refreshState, 3000);
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

  const derash = Math.max(0, acceptedCount * STAKE * 0.8);
  const cardRowsA = selectedA ? buildCard(selectedA) : null;
  const cardRowsB = selectedB ? buildCard(selectedB) : null;
  const totalBalance = wallet + gift;
  const selectedCount = (selectedA ? 1 : 0) + (selectedB ? 1 : 0);
  const selectedCost = selectedCount * STAKE;
  const remainingBalance = Math.max(0, totalBalance - selectedCost);
  const startsInText =
    countdown === "-"
      ? "00:--"
      : countdown === "Starting..."
        ? "00:00"
        : `00:${String(countdown).padStart(2, "0")}`;

  return (
    <>
      <Head>
        <title>Bingo</title>
      </Head>

      {splashVisible && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-bg text-muted font-extrabold text-base transition-opacity duration-300">
          <div className="flex flex-col items-center gap-3">
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-purple-glow animate-pulse3"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <div>Loading...</div>
          </div>
        </div>
      )}

      {splashError && (
        <div className="mx-auto max-w-[420px] px-2.5 sm:px-3 pt-2">
          <div className="bg-amber-200/90 text-amber-950 border border-amber-300 rounded-lg px-3 py-2 text-xs sm:text-sm font-semibold flex items-center justify-between gap-2">
            <span>{splashError}</span>
            <button
              type="button"
              onClick={refreshState}
              className="bg-amber-700/90 text-amber-100 font-bold rounded-md px-2.5 py-1"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="w-full min-h-[100svh]">
        <div className="bg-slate-900 text-slate-100 px-2.5 py-2 sm:px-3 sm:py-2.5">
          <div className="h-4 sm:h-5" />
          {countdown !== "-" && (
            <div className="mb-2 flex justify-center">
              <div className="bg-amber-400/95 text-amber-950 font-black rounded-lg px-3 py-1.5 text-xs sm:text-sm derash-float">
                Starts In: {startsInText}
              </div>
            </div>
          )}
          <div className="mt-1.5 sm:mt-2 grid grid-cols-5 gap-2 items-stretch">
            <div className="bg-teal-500/90 text-teal-950 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0">
              Game: {totalGames}
            </div>
            <div className="bg-emerald-500/90 text-emerald-950 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0">
              Bet: {STAKE} Birr
            </div>
            <div className="bg-indigo-500/90 text-indigo-950 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0">
              Balance: {Number(totalBalance || 0).toFixed(2)} Birr
            </div>
            <div className="bg-amber-400/95 text-amber-950 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0">
              Players: {acceptedCount}
            </div>
            <div className="bg-amber-400/95 text-amber-950 font-bold rounded-lg px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs text-center whitespace-normal leading-tight min-w-0 derash-float">
              Derash: {Math.round(derash)} ETB
            </div>
          </div>
        </div>

        <div className="p-2 sm:p-3">
          <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-2.5 sm:p-3">
            <div className="max-h-[52vh] overflow-y-auto no-scrollbar -mx-2 sm:-mx-3">
              <div className="grid grid-cols-8 gap-1 sm:gap-2">
                {numbers.map((n) => {
                  const key = String(n);
                  const isTaken = taken.has(key);
                  const isSelected = selectedA === n || selectedB === n;
                  const base =
                    "relative font-extrabold rounded-md sm:rounded-lg aspect-square flex items-center justify-center select-none text-xs sm:text-base leading-none border";
                  const cls = isSelected
                    ? "bg-[#f50707] border-[#f50707] text-white"
                    : isTaken
                      ? "bg-[#f50707] border-[#f50707] text-white"
                      : "bg-emerald-500 border-emerald-200 text-emerald-950";

                  return (
                    <button
                      key={n}
                      type="button"
                      className={`${base} ${cls}`}
                      disabled={isTaken && !isSelected}
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
                    >
                      {n}
                      {isSelected && (
                        <span className="absolute top-0.5 right-0.5 text-[9px] leading-none">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {showInsufficient && (
              <div className="mt-3 bg-amber-200/80 text-amber-900 rounded-lg px-3 py-2 text-center text-sm font-semibold">
                Insufficient Funds - ({Number(insufficientNeed || 0).toFixed(2)}{" "}
                Birr)
              </div>
            )}

            {(selectedA || selectedB) && (
              <div className="mt-3.5 sm:mt-4 grid grid-cols-2 gap-2.5 sm:gap-3">
                <div
                  className={`border rounded-xl p-1.5 sm:p-2 ${
                    activeSlot === 0
                      ? "bg-slate-900/80 border-indigo-500/70"
                      : "bg-slate-900/70 border-slate-700"
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveSlot(0)}
                  onKeyDown={() => setActiveSlot(0)}
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
                    {cardRowsA &&
                      cardRowsA.flat().map((val, i) => (
                        <div
                          key={i}
                          className={`rounded-sm sm:rounded-md aspect-square flex items-center justify-center font-bold border text-[10px] sm:text-sm leading-none ${
                            val === "FREE"
                              ? "bg-slate-700 border-slate-600 text-white"
                              : "bg-teal-900/50 border-teal-700 text-teal-100"
                          }`}
                        >
                          {val === "FREE" ? "★" : val}
                        </div>
                      ))}
                  </div>
                </div>

                {selectedB ? (
                  <div
                    className={`border rounded-xl p-1.5 sm:p-2 ${
                      activeSlot === 1
                        ? "bg-slate-900/80 border-indigo-500/70"
                        : "bg-slate-900/70 border-slate-700"
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveSlot(1)}
                    onKeyDown={() => setActiveSlot(1)}
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
                      {cardRowsB &&
                        cardRowsB.flat().map((val, i) => (
                          <div
                            key={i}
                            className={`rounded-sm sm:rounded-md aspect-square flex items-center justify-center font-bold border text-[10px] sm:text-sm leading-none ${
                              val === "FREE"
                                ? "bg-slate-700 border-slate-600 text-white"
                                : "bg-teal-900/50 border-teal-700 text-teal-100"
                            }`}
                          >
                            {val === "FREE" ? "★" : val}
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="border border-dashed border-slate-600 rounded-xl p-3 bg-slate-900/40 flex items-center justify-center text-center">
                    <div className="text-xs text-slate-300 leading-relaxed">
                      If you want, select a second card to play with
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="text-muted text-[10px] text-center mt-3">
            Copyright weyra Bingo 2026
          </div>
        </div>
      </div>
    </>
  );
}

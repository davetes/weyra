import { useRouter } from "next/router";
import Head from "next/head";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { History, Wallet, User, Gamepad2 } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [toast, setToast] = useState("");
  const [logoError, setLogoError] = useState(false);
  const [stakeState, setStakeState] = useState({});

  const tid = useMemo(() => {
    const raw = router.query?.tid;
    return raw != null ? String(raw) : "";
  }, [router.query]);

  function goPlay(stake) {
    const q = new URLSearchParams();
    q.set("stake", String(stake));
    if (tid) q.set("tid", tid);
    router.push(`/play?${q.toString()}`);
  }

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let alive = true;
    const stakes = [10, 20, 50];

    const refresh = async () => {
      try {
        const results = await Promise.all(
          stakes.map(async (s) => {
            const r = await fetch(`/api/stake_state?stake=${s}`);
            if (!r.ok) return [s, null];
            const d = await r.json();
            return [s, d];
          }),
        );
        if (!alive) return;
        setStakeState((prev) => {
          const next = { ...prev };
          for (const [s, d] of results) {
            if (d && d.ok) next[String(s)] = d;
          }
          return next;
        });
      } catch (_) {}
    };

    refresh();
    const iv = setInterval(refresh, 2500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  function renderStakeStatus(stake) {
    const s = stakeState?.[String(stake)] || null;
    const active = !!s?.started;
    return (
      <div className="flex-1 flex justify-center">
        <div
          className={`px-2 py-1 text-[10px] font-black border ${
            active
              ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/40"
              : "bg-slate-900/40 text-slate-300 border-white/10"
          }`}
        >
          {active ? "ACTIVE" : "WAITING"}
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Weyra Bingo</title>
      </Head>
      <div className="min-h-[100svh] w-full bg-gradient-to-b from-[#0F172A] via-[#0B1220] to-[#0F172A] text-white pb-24">
        {toast && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] px-3">
            <div className="bg-slate-950/85 border border-white/10 text-white text-xs sm:text-sm font-semibold px-3 py-2 shadow-lg">
              {toast}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="px-4 pt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {!logoError ? (
                <div className="relative w-14 h-14 rounded-[50%] overflow-hidden shadow-glow-gold">
                  <Image
                    src={
                      process.env.NEXT_PUBLIC_START_IMAGE_URL ||
                      "/static/images/bingo.jpg"
                    }
                    alt="Weyra Bingo"
                    fill
                    sizes="56px"
                    priority
                    className="object-cover"
                    onError={() => setLogoError(true)}
                  />
                </div>
              ) : (
                <div className="w-10 h-10 bg-gradient-to-br from-[#FACC15] to-[#EAB308] flex items-center justify-center shadow-glow-gold">
                  <span className="text-white font-black text-lg">W</span>
                </div>
              )}
              <div
                className="text-lg font-serif font-black "
                style={{ fontFamily: "Space Grotesk, system-ui, sans-serif" }}
              >
                WEYRA BINGO
              </div>
            </div>

            <button
              type="button"
              className="h-10 px-4 border border-[#FACC15]/25 bg-white/5 text-sm font-semibold hover:bg-white/10 hover:border-[#FACC15]/40 transition-all"
              onClick={() => router.push("/rules")}
            >
              Rules
            </button>
          </div>
        </div>

        {/* Stake Selection */}
        <div className="px-4 pt-8">
          <div className="glass-card p-5 rounded-none">
            <div
              className="text-center font-black text-lg mb-4"
              style={{ fontFamily: "Space Grotesk, system-ui, sans-serif" }}
            >
              Choose Your Stake
            </div>

            <div className="space-y-4">
              <button
                type="button"
                onClick={() => goPlay(10)}
                className="stake-btn stake-10"
              >
                <div className="stake-btn-inner">
                  <div className="text-left">
                    <div className="stake-btn-title">10 ETB</div>
                    <div className="stake-btn-sub">Weyra</div>
                  </div>
                  {renderStakeStatus(10)}
                  <div className="stake-btn-chip">PLAY</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => goPlay(20)}
                className="stake-btn stake-20"
              >
                <div className="stake-btn-inner">
                  <div className="text-left">
                    <div className="stake-btn-title">20 ETB</div>
                    <div className="stake-btn-sub">Fortune</div>
                  </div>
                  {renderStakeStatus(20)}
                  <div className="stake-btn-chip">PLAY</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => goPlay(50)}
                className="stake-btn stake-50"
              >
                <div className="stake-btn-inner">
                  <div className="text-left">
                    <div className="stake-btn-title">50 ETB</div>
                    <div className="stake-btn-sub">Buna</div>
                  </div>
                  {renderStakeStatus(50)}
                  <div className="stake-btn-chip">PLAY</div>
                </div>
              </button>
            </div>

            {!tid && (
              <div className="mt-4 text-center text-xs text-muted"></div>
            )}
          </div>
        </div>

        {/* Bottom Navigation */}
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(420px,calc(100vw-1.25rem))] z-[9999]">
          <div className="glass-card-light px-3 py-2">
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() =>
                  router.push(tid ? `/?tid=${encodeURIComponent(tid)}` : "/")
                }
                className="flex flex-col items-center justify-center py-2 bg-gradient-to-br from-[#38bdf8]/20 to-[#1d4ed8]/20 border border-[#38bdf8]/35 text-white shadow-[0_0_18px_rgba(56,189,248,0.12)]"
              >
                <Gamepad2 className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Game</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    tid
                      ? `/history?tid=${encodeURIComponent(tid)}`
                      : "/history",
                  )
                }
                className="flex flex-col items-center justify-center py-2 text-slate-300 hover:bg-white/5 transition-all"
              >
                <History className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">History</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    tid ? `/wallet?tid=${encodeURIComponent(tid)}` : "/wallet",
                  )
                }
                className="flex flex-col items-center justify-center py-2 text-slate-300 hover:bg-white/5 transition-all"
              >
                <Wallet className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Wallet</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    tid
                      ? `/profile?tid=${encodeURIComponent(tid)}`
                      : "/profile",
                  )
                }
                className="flex flex-col items-center justify-center py-2 text-slate-300 hover:bg-white/5 transition-all"
              >
                <User className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Profile</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

import { useRouter } from "next/router";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { Gamepad2, History, Wallet, User } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [toast, setToast] = useState("");

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

  return (
    <>
      <Head>
        <title>weyra Bingo</title>
      </Head>
      <div className="min-h-[100svh] w-full bg-gradient-to-b from-violet-950 via-slate-950 to-slate-950 text-white pb-24">
        {toast && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] px-3">
            <div className="bg-slate-900/90 border border-white/10 text-white text-xs sm:text-sm font-semibold px-3 py-2 rounded-xl shadow-lg">
              {toast}
            </div>
          </div>
        )}
        <div className="px-4 pt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white text-violet-900 font-black flex items-center justify-center">
                W
              </div>
              <div className="text-lg font-black tracking-tight">Weyra Bingo</div>
            </div>

            <button
              type="button"
              className="h-10 px-4 rounded-xl border border-white/15 bg-white/5 text-sm font-semibold"
              onClick={() => router.push("/rules")}
            >
              Rules
            </button>
          </div>
        </div>

        <div className="px-4 pt-10">
          <div className="text-center">
            <div className="text-4xl font-black leading-tight">
              Welcome to <span className="text-amber-400">Weyra</span>
              <br />
              <span className="text-amber-400">Bingo</span>
            </div>
          </div>

          <div className="mt-8 border border-amber-400/40 rounded-2xl bg-white/5 p-4">
            <div className="text-center font-black text-lg">
              Choose Your Stake
            </div>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={() => goPlay(10)}
                className="w-full h-14 rounded-2xl bg-emerald-500 text-emerald-950 font-black text-xl shadow-[0_10px_30px_rgba(16,185,129,0.25)]"
              >
                Play 10
              </button>
              <button
                type="button"
                onClick={() => goPlay(20)}
                className="w-full h-14 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-black text-xl shadow-[0_10px_30px_rgba(59,130,246,0.25)]"
              >
                Play 20
              </button>
              <button
                type="button"
                onClick={() => goPlay(50)}
                className="w-full h-14 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-amber-950 font-black text-xl shadow-[0_10px_30px_rgba(245,158,11,0.25)]"
              >
                Play 50
              </button>
            </div>

            {!tid && (
              <div className="mt-4 text-center text-xs text-white/70">
                Open from Telegram to play.
              </div>
            )}
          </div>
        </div>

        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(420px,calc(100vw-1.25rem))] z-[9999]">
          <div className="bg-slate-950/70 backdrop-blur border border-white/10 rounded-2xl px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => router.push(tid ? `/?tid=${encodeURIComponent(tid)}` : "/")}
                className="flex flex-col items-center justify-center py-2 rounded-xl bg-sky-500/15 border border-sky-400/20 text-sky-200"
              >
                <Gamepad2 className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Game</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(tid ? `/history?tid=${encodeURIComponent(tid)}` : "/history")
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
              >
                <History className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">History</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(tid ? `/wallet?tid=${encodeURIComponent(tid)}` : "/wallet")
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
              >
                <Wallet className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Wallet</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(tid ? `/profile?tid=${encodeURIComponent(tid)}` : "/profile")
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
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

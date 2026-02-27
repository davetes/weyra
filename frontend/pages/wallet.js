import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { Gamepad2, History, RotateCw, User, Wallet as WalletIcon } from "lucide-react";

export default function WalletPage() {
  const router = useRouter();
  const tid = useMemo(() => {
    const raw = router.query?.tid;
    return raw != null ? String(raw) : "";
  }, [router.query]);

  const [activeTab, setActiveTab] = useState("balance");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [wallet, setWallet] = useState(0);
  const [gift, setGift] = useState(0);
  const [phone, setPhone] = useState("");

  async function refresh() {
    if (!tid) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/game_state?stake=10&tid=${encodeURIComponent(tid)}`);
      if (!res.ok) {
        setError("Failed to load wallet");
        return;
      }
      const data = await res.json();
      setWallet(typeof data.wallet === "number" ? data.wallet : 0);
      setGift(typeof data.gift === "number" ? data.gift : 0);
      setPhone(typeof data.phone === "string" ? data.phone : "");
    } catch (e) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [tid]);

  const verified = String(phone || "").trim().length > 0;

  return (
    <>
      <Head>
        <title>Wallet</title>
      </Head>

      <div className="min-h-[100svh] w-full bg-gradient-to-b from-violet-950 via-slate-950 to-slate-950 text-white pb-24">
        <div className="px-4 pt-6">
          <div className="flex items-center justify-between">
            <div className="text-3xl font-black tracking-tight">Wallet</div>
            <button
              type="button"
              onClick={refresh}
              disabled={!tid || loading}
              className="w-10 h-10 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center disabled:opacity-50"
              aria-label="Refresh"
            >
              <RotateCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-slate-900/60 border border-white/10 flex items-center justify-center flex-none">
                <User className="w-5 h-5 text-white/80" />
              </div>
              <div className="font-black text-lg truncate">
                {phone || "—"}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-none">
              {verified && (
                <div className="h-8 px-3 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-300 font-bold text-sm flex items-center">
                  Verified
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-1">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("balance")}
                className={`h-11 rounded-xl font-black ${
                  activeTab === "balance"
                    ? "bg-white/10 text-white"
                    : "text-white/60"
                }`}
              >
                Balance
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("history")}
                className={`h-11 rounded-xl font-black ${
                  activeTab === "history"
                    ? "bg-white/10 text-white"
                    : "text-white/60"
                }`}
              >
                History
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 font-semibold">
              {error}
            </div>
          )}

          {activeTab === "balance" ? (
            <div className="mt-8 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 px-5 py-6 flex items-center justify-between">
                <div className="text-xl font-semibold text-white/70">Main Wallet</div>
                <div className="text-4xl font-black">{Number(wallet || 0).toFixed(2)}</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-900/40 px-5 py-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <History className="w-5 h-5 text-white/70" />
                  </div>
                  <div className="text-xl font-semibold text-white/70">Play Wallet</div>
                </div>
                <div className="text-4xl font-black text-emerald-400">
                  {Number(gift || 0).toFixed(2)}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 text-white/70 text-sm">
              Transaction history will appear here.
            </div>
          )}
        </div>

        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(420px,calc(100vw-1.25rem))] z-[9999]">
          <div className="bg-slate-950/70 backdrop-blur border border-white/10 rounded-2xl px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => router.push(tid ? `/?tid=${encodeURIComponent(tid)}` : "/")}
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
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
                onClick={() => router.push(tid ? `/wallet?tid=${encodeURIComponent(tid)}` : "/wallet")}
                className="flex flex-col items-center justify-center py-2 rounded-xl bg-sky-500/15 border border-sky-400/20 text-sky-200"
              >
                <WalletIcon className="w-5 h-5" />
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

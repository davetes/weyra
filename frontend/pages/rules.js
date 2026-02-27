import Head from "next/head";
import { useMemo } from "react";
import { useRouter } from "next/router";
import { Gamepad2, History, User, Wallet as WalletIcon } from "lucide-react";

export default function RulesPage() {
  const router = useRouter();

  const tid = useMemo(() => {
    const raw = router.query?.tid;
    return raw != null ? String(raw) : "";
  }, [router.query]);

  return (
    <>
      <Head>
        <title>Rules</title>
      </Head>

      <div className="min-h-[100svh] w-full bg-gradient-to-b from-violet-950 via-slate-950 to-slate-950 text-white pb-24">
        <div className="px-4 pt-6">
          <div className="flex items-center justify-between">
            <div className="text-3xl font-black tracking-tight">Rules</div>
            <button
              type="button"
              onClick={() => router.back()}
              className="h-10 px-4 rounded-xl border border-white/15 bg-white/5 text-sm font-semibold"
            >
              Back
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-lg font-black">How to play</div>
            <div className="mt-3 space-y-3 text-sm text-white/80 leading-relaxed">
              <div>
                1) Choose your stake, then select 1 or 2 cards.
              </div>
              <div>
                2) When the game starts, mark numbers on your card as they are called.
              </div>
              <div>
                3) Win by completing a valid pattern (row, column, diagonal, or corners) and then press BINGO.
              </div>
              <div>
                4) Pressing BINGO without a valid win will disqualify your card.
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-lg font-black">መመሪያ</div>
            <div className="mt-3 space-y-3 text-sm text-white/80 leading-relaxed">
              <div>
                1) መወራረጃዎን ይምረጡ እና 1 ወይም 2 ካርዶች ይምረጡ።
              </div>
              <div>
                2) ጨዋታው ሲጀምር የሚወጡትን ቁጥሮች በካርድዎ ላይ ያቅልሙ።
              </div>
              <div>
                3) ትክክለኛ ፓተርን ሲሞሉ (መስመር/አምድ/ጋድም/አራቱ ጠርዞች) ከዚያ BINGO ይጫኑ።
              </div>
              <div>
                4) ትክክለኛ ቢንጎ ሳይኖር BINGO ቢጫኑ ካርድዎ ይባረራል።
              </div>
            </div>
          </div>
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
                onClick={() =>
                  router.push(tid ? `/wallet?tid=${encodeURIComponent(tid)}` : "/wallet")
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
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

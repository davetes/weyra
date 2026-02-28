import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { login, loadToken, saveToken, fetchMe } from "../lib/auth";
import Button from "../components/Button";
import { Input } from "../components/FormElements";
import { IconEye } from "../components/Icons";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    async function redirectIfAuthed() {
      const token = loadToken();
      if (!token) return;
      try {
        await fetchMe(token);
        router.replace("/app");
      } catch (_) {
        saveToken(null);
      }
    }
    redirectIfAuthed();
  }, [router]);

  async function onLogin() {
    setLoading(true);
    setError("");
    try {
      const res = await login(username, password);
      saveToken(res.token);
      router.replace("/app");
    } catch (err) {
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    onLogin();
  }

  return (
    <div className="min-h-screen bg-bg text-slate-100 flex items-center justify-center p-6">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-hover/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-slide-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-accent-hover shadow-glow-lg mb-4">
            <span className="text-2xl font-extrabold text-white">W</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Weyra Bingo</h1>
          <p className="text-sm text-muted mt-1">Admin Control Panel</p>
        </div>

        <div className="bg-panel border border-border rounded-2xl shadow-card overflow-hidden">
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5 uppercase tracking-wider">
                Username
              </label>
              <Input
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <input
                  className="w-full bg-bg-secondary border border-border rounded-xl text-sm text-slate-200 placeholder:text-muted transition-colors focus:border-accent/50 px-3 pr-11 py-2.5"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-slate-200 transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((s) => !s)}
                >
                  <IconEye
                    size={18}
                    className={showPassword ? "text-slate-200" : ""}
                  />
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger animate-fade-in">
                {error}
              </div>
            )}

            <Button
              variant="primary"
              className="w-full !py-3"
              loading={loading}
              type="submit"
            >
              Sign In
            </Button>
          </form>
        </div>

        <div className="text-center mt-6 text-xs text-muted">
          Secure admin access• API proxied through Next.js
        </div>
      </div>
    </div>
  );
}

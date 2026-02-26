/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./pages/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0f1a",
        "bg-secondary": "#0d1321",
        panel: "#111827",
        "panel-light": "#1f2937",
        border: "#1e3a5f",
        "border-light": "#334155",
        muted: "#94a3b8",
        accent: "#22c55e",
        "accent-hover": "#4ade80",
        "accent-dim": "#15803d",
        primary: "#0ea5e9",
        "primary-dark": "#0284c7",
        "purple-dark": "#1e1b4b",
        "purple-mid": "#4c1d95",
        "purple-bright": "#8b5cf6",
        "purple-glow": "#a78bfa",
        "green-bingo": "#22c55e",
        "red-bingo": "#f43f5e",
        "red-called": "#e11d48",
        "yellow-bingo": "#eab308",
        "blue-bingo": "#3b82f6",
        "pink-bingo": "#ec4899",
        cyan: "#06b6d4",
        "cyan-dark": "#0891b2",
        "cyan-light": "#22d3ee",
        gold: "#fbbf24",
        "gold-border": "#f59e0b",
        "gold-gradient-from": "#fbbf24",
        "gold-gradient-to": "#f97316",
        "board-cell": "#1e293b",
        "card-free": "#065f46",
        "card-free-border": "#10b981",
        "taken-card": "#1f2937",
        "taken-card-border": "#374151",
        surface: "#0f172a",
        "surface-light": "#1e293b",
        "emerald-glow": "#22c55e",
      },
      fontFamily: {
        sans: [
          "Space Grotesk",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      keyframes: {
        pulse3: {
          "0%, 80%, 100%": { transform: "scale(0.6)", opacity: "0.6" },
          "40%": { transform: "scale(1)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.9)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(30px) scale(0.95)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        glow: {
          "0%, 100%": { boxShadow: "0 0 5px rgba(16,185,129,0.3)" },
          "50%": { boxShadow: "0 0 20px rgba(16,185,129,0.6)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        countPulse: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.1)" },
        },
        bounceIn: {
          "0%": { transform: "scale(0.3)", opacity: "0" },
          "50%": { transform: "scale(1.05)" },
          "70%": { transform: "scale(0.95)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        confetti: {
          "0%": { transform: "translateY(0) rotateZ(0)", opacity: "1" },
          "100%": {
            transform: "translateY(400px) rotateZ(720deg)",
            opacity: "0",
          },
        },
        ringPulse: {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(1.5)", opacity: "0" },
        },
      },
      animation: {
        pulse3: "pulse3 1.2s infinite ease-in-out",
        shimmer: "shimmer 2s infinite linear",
        fadeInUp: "fadeInUp 0.4s ease-out",
        fadeIn: "fadeIn 0.3s ease-out",
        scaleIn: "scaleIn 0.3s ease-out",
        slideUp: "slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        glow: "glow 2s infinite ease-in-out",
        float: "float 3s infinite ease-in-out",
        countPulse: "countPulse 1s infinite ease-in-out",
        bounceIn: "bounceIn 0.5s ease-out",
        confetti: "confetti 1.5s ease-out forwards",
        ringPulse: "ringPulse 1.5s infinite ease-out",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-game":
          "linear-gradient(135deg, #0b1120 0%, #131c2e 50%, #101829 100%)",
      },
      boxShadow: {
        "glow-cyan":
          "0 0 20px rgba(6,182,212,0.4), 0 0 40px rgba(6,182,212,0.2)",
        "glow-green":
          "0 0 20px rgba(34,197,94,0.4), 0 0 40px rgba(34,197,94,0.2)",
        "glow-accent":
          "0 0 25px rgba(34,197,94,0.3), 0 0 50px rgba(34,197,94,0.15)",
        "glow-emerald":
          "0 0 40px rgba(34,197,94,0.25), 0 0 80px rgba(34,197,94,0.15)",
        "glow-gold":
          "0 0 20px rgba(251,191,36,0.4), 0 0 40px rgba(251,191,36,0.2)",
        "glow-purple":
          "0 0 20px rgba(139,92,246,0.4), 0 0 40px rgba(139,92,246,0.2)",
        card: "0 4px 20px -2px rgba(0,0,0,0.4), 0 2px 8px -2px rgba(0,0,0,0.3)",
        "card-hover":
          "0 12px 35px -5px rgba(0,0,0,0.5), 0 10px 15px -6px rgba(0,0,0,0.35)",
        modal:
          "0 30px 60px -15px rgba(0,0,0,0.8), 0 0 40px rgba(139,92,246,0.15)",
        "inner-glow": "inset 0 1px 0 rgba(255,255,255,0.08)",
        cell: "0 2px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)",
        "neon-green": "0 0 5px #22c55e, 0 0 20px rgba(34,197,94,0.5)",
        "neon-gold": "0 0 5px #fbbf24, 0 0 20px rgba(251,191,36,0.5)",
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./pages/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0f1a",
        "bg-secondary": "#0f1629",
        panel: "#111a2e",
        "panel-hover": "#162038",
        border: "#1e2d4a",
        "border-light": "#2a3f66",
        muted: "#64748b",
        accent: "#6366f1",
        "accent-hover": "#4f46e5",
        "accent-light": "#818cf8",
        "accent-muted": "rgba(99,102,241,0.15)",
        success: "#10b981",
        "success-muted": "rgba(16,185,129,0.15)",
        warning: "#f59e0b",
        "warning-muted": "rgba(245,158,11,0.15)",
        danger: "#ef4444",
        "danger-muted": "rgba(239,68,68,0.15)",
        info: "#06b6d4",
        "info-muted": "rgba(6,182,212,0.15)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(99,102,241,0.15)",
        "glow-lg": "0 0 40px rgba(99,102,241,0.2)",
        card: "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3)",
        sidebar: "4px 0 24px rgba(0,0,0,0.3)",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "slide-in-left": "slideInLeft 0.3s ease-out",
        "pulse-slow": "pulse 3s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInLeft: {
          "0%": { opacity: "0", transform: "translateX(-10px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};

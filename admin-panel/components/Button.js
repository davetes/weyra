// Reusable Button component
export default function Button({
  children,
  variant = "default",
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled = false,
  className = "",
  ...props
}) {
  const variants = {
    default:
      "bg-panel/90 border border-border/80 text-slate-200 hover:bg-panel-hover/90 hover:border-border-light/90",
    primary:
      "bg-accent hover:bg-accent-hover text-white shadow-glow hover:shadow-glow-lg",
    success: "bg-success/90 hover:bg-success text-white",
    danger: "bg-danger/90 hover:bg-danger text-white",
    ghost:
      "text-slate-300 hover:text-slate-100 hover:bg-white/5 border border-transparent",
    outline:
      "bg-transparent border border-border/80 text-slate-200 hover:bg-white/5 hover:border-border-light/90",
  };

  const sizes = {
    xs: "text-xs px-2 py-1 rounded-lg gap-1",
    sm: "text-xs px-2.5 py-1.5 rounded-lg gap-1.5",
    md: "text-sm px-3.5 py-2 rounded-xl gap-2",
    lg: "text-sm px-5 py-2.5 rounded-xl gap-2",
  };

  return (
    <button
      className={`inline-flex items-center justify-center font-medium select-none whitespace-nowrap transition-all duration-200 ease-out disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:translate-y-[1px] ${variants[variant] || variants.default} ${sizes[size] || sizes.md} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : Icon ? (
        <Icon size={size === "xs" || size === "sm" ? 14 : 16} />
      ) : null}{" "}
      {children}{" "}
      {IconRight && (
        <IconRight size={size === "xs" || size === "sm" ? 14 : 16} />
      )}{" "}
    </button>
  );
}

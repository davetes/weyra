// Badge component for status labels
export default function Badge({
  children,
  variant = "default",
  dot = false,
  className = "",
}) {
  const variants = {
    default: "bg-slate-800 text-slate-300 border-slate-700",
    success: "bg-success-muted text-success border-success/20",
    danger: "bg-danger-muted text-danger border-danger/20",
    warning: "bg-warning-muted text-warning border-warning/20",
    info: "bg-info-muted text-info border-info/20",
    accent: "bg-accent-muted text-accent-light border-accent/20",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${variants[variant] || variants.default} ${className}`}
    >
      {" "}
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            variant === "success"
              ? "bg-success"
              : variant === "danger"
                ? "bg-danger"
                : variant === "warning"
                  ? "bg-warning"
                  : variant === "info"
                    ? "bg-info"
                    : variant === "accent"
                      ? "bg-accent-light"
                      : "bg-slate-400"
          }`}
        />
      )}{" "}
      {children}{" "}
    </span>
  );
}

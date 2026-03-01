export default function Card({
  title,
  right,
  children,
  className = "",
  noPadding = false,
  icon: Icon,
}) {
  return (
    <div
      className={`bg-panel/95 border border-border/80 rounded-2xl shadow-card transition-all duration-200 hover:shadow-card-hover hover:border-border-light/70 animate-fade-in ${className}`}
    >
      {" "}
      {(title || right) && (
        <div className="flex items-start justify-between px-5 pt-5 pb-0 gap-3">
          <div className="flex items-center gap-2.5">
            {" "}
            {Icon && <Icon size={18} className="text-accent-light" />}{" "}
            <h2 className="font-semibold text-slate-100 tracking-tight">
              {" "}
              {title}{" "}
            </h2>{" "}
          </div>{" "}
          {right}{" "}
        </div>
      )}{" "}
      <div className={noPadding ? "" : "px-5 pb-5 pt-4"}> {children} </div>{" "}
    </div>
  );
}

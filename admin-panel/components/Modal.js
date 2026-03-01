import { IconX } from "./Icons";

// Modal/Dialog component
export default function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-2xl",
  zIndex = "z-50",
}) {
  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center p-4 animate-fade-in`}
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
      />{" "}
      <div
        className={`relative w-full ${maxWidth} bg-panel/95 border border-border/80 rounded-2xl shadow-glow-lg animate-slide-up`}
      >
        {" "}
        {(title || onClose) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/80">
            <h3 className="font-semibold text-lg text-slate-100 tracking-tight">
              {" "}
              {title}{" "}
            </h3>{" "}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-muted hover:text-slate-200 hover:bg-white/10 transition-colors"
            >
              <IconX size={18} />{" "}
            </button>{" "}
          </div>
        )}{" "}
        <div className="p-6"> {children} </div>{" "}
      </div>{" "}
    </div>
  );
}

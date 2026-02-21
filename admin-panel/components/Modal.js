import { IconX } from "./Icons";

// Modal/Dialog component
export default function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-2xl",
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />{" "}
      <div
        className={`relative w-full ${maxWidth} bg-panel border border-border rounded-2xl shadow-glow-lg animate-slide-up`}
      >
        {" "}
        {(title || onClose) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h3 className="font-semibold text-lg text-slate-100"> {title} </h3>{" "}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-slate-200 hover:bg-white/10 transition"
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

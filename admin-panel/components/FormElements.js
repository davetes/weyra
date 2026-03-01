import { IconSearch } from "./Icons";

// Enhanced input field
export function Input({ icon: Icon, className = "", ...props }) {
  return (
    <div className="relative">
      {" "}
      {Icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
          <Icon size={16} />{" "}
        </div>
      )}{" "}
      <input
        className={`w-full bg-bg-secondary/90 border border-border/80 rounded-xl text-sm text-slate-200 placeholder:text-muted transition-all duration-200 hover:border-border-light/80 focus:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${Icon ? "pl-9 pr-3" : "px-3"} py-2.5 ${className}`}
        {...props}
      />{" "}
    </div>
  );
}

// Search input with icon
export function SearchInput({ className = "", ...props }) {
  return <Input icon={IconSearch} className={className} {...props} />;
}

// Select dropdown
export function Select({ children, className = "", ...props }) {
  return (
    <select
      className={`bg-bg-secondary/90 border border-border/80 rounded-xl px-3 py-2.5 text-sm text-slate-200 transition-all duration-200 hover:border-border-light/80 focus:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-bg appearance-none cursor-pointer ${className}`}
      {...props}
    >
      {children}{" "}
    </select>
  );
}

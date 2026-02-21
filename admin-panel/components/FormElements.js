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
        className={`w-full bg-bg-secondary border border-border rounded-xl text-sm text-slate-200 placeholder:text-muted transition-colors focus:border-accent/50 ${Icon ? "pl-9 pr-3" : "px-3"} py-2.5 ${className}`}
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
      className={`bg-bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-slate-200 transition-colors focus:border-accent/50 appearance-none cursor-pointer ${className}`}
      {...props}
    >
      {children}{" "}
    </select>
  );
}

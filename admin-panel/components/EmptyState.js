// Empty state placeholder
export default function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {" "}
      {Icon && (
        <div className="bg-accent-muted text-accent-light p-4 rounded-2xl mb-4">
          <Icon size={28} />{" "}
        </div>
      )}{" "}
      <div className="text-sm font-medium text-slate-300">
        {" "}
        {title || "No data"}{" "}
      </div>{" "}
      {description && (
        <div className="text-xs text-muted mt-1 max-w-xs"> {description} </div>
      )}{" "}
    </div>
  );
}

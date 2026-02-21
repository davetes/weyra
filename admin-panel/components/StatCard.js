// Stat card for dashboard metrics
export default function StatCard({ label, value, sub, icon: Icon, color = 'accent', trend }) {
    const colorMap = {
        accent: { bg: 'bg-accent-muted', text: 'text-accent-light', border: 'border-accent/20' },
        success: { bg: 'bg-success-muted', text: 'text-success', border: 'border-success/20' },
        warning: { bg: 'bg-warning-muted', text: 'text-warning', border: 'border-warning/20' },
        danger: { bg: 'bg-danger-muted', text: 'text-danger', border: 'border-danger/20' },
        info: { bg: 'bg-info-muted', text: 'text-info', border: 'border-info/20' },
    };
    const c = colorMap[color] || colorMap.accent;

    return (
        <div className={`bg-panel border border-border rounded-2xl p-5 shadow-card transition-all hover:shadow-card-hover hover:border-border-light animate-slide-up group`}>
            <div className="flex items-start justify-between">
                <div className="space-y-1">
                    <div className="text-xs font-medium text-muted uppercase tracking-wider">{label}</div>
                    <div className="text-2xl font-bold text-slate-100 mt-1">{value ?? '-'}</div>
                    {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
                    {trend && (
                        <div className={`text-xs font-medium ${trend > 0 ? 'text-success' : 'text-danger'} mt-1`}>
                            {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
                        </div>
                    )}
                </div>
                {Icon && (
                    <div className={`${c.bg} ${c.text} p-2.5 rounded-xl transition-transform group-hover:scale-110`}>
                        <Icon size={22} />
                    </div>
                )}
            </div>
        </div>
    );
}
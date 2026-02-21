export default function Card({ title, right, children }) {
    return (
        <div className="bg-panel border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold">{title}</h2>
                {right}
            </div>
            {children}
        </div>
    );
}

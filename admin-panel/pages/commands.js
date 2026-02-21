import RequireAuth from '../components/RequireAuth';
import AdminShell from '../components/AdminShell';
import Card from '../components/Card';
import { saveToken } from '../lib/auth';

export default function CommandsPage() {
    return (
        <RequireAuth>
            {({ admin }) => (
                <AdminShell
                    admin={admin}
                    title="Commands"
                    onLogout={() => {
                        saveToken(null);
                        window.location.href = '/login';
                    }}
                >
                    <div className="grid md:grid-cols-2 gap-4">
                        <Card title="Admin Commands">
                            <ul className="text-sm text-slate-300 list-disc pl-4 space-y-1">
                                <li>/admin or /help</li>
                                <li>/username &lt;new_username&gt;</li>
                                <li>/present</li>
                                <li>/top10</li>
                                <li>/topdaily</li>
                                <li>/topweekly</li>
                                <li>/post &lt;message|photo|file|playnow&gt;</li>
                            </ul>
                        </Card>
                        <Card title="Entertainer Commands">
                            <ul className="text-sm text-slate-300 list-disc pl-4 space-y-1">
                                <li>/balances &lt;id|@username&gt;</li>
                                <li>/add &lt;id|@username&gt; &lt;amount&gt;</li>
                                <li>/subtract &lt;id|@username&gt; &lt;amount&gt;</li>
                                <li>/roles</li>
                            </ul>
                        </Card>
                    </div>
                </AdminShell>
            )}
        </RequireAuth>
    );
}

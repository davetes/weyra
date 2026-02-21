import RequireAuth from '../components/RequireAuth';
import AdminShell from '../components/AdminShell';
import Card from '../components/Card';
import { saveToken } from '../lib/auth';

export default function DashboardPage() {
    return (
        <RequireAuth>
            {({ admin }) => (
                <AdminShell
                    admin={admin}
                    title="Dashboard"
                    onLogout={() => {
                        saveToken(null);
                        window.location.href = '/login';
                    }}
                >
                    <div className="grid md:grid-cols-3 gap-4">
                        <Card title="Players">
                            <div className="text-sm text-slate-300">Use the Players page to search and ban/unban.</div>
                        </Card>
                        <Card title="Admins">
                            <div className="text-sm text-slate-300">Super Admin can create Admin / Entertainer accounts.</div>
                        </Card>
                        <Card title="Settings">
                            <div className="text-sm text-slate-300">Update key/value settings for the application.</div>
                        </Card>
                    </div>
                </AdminShell>
            )}
        </RequireAuth>
    );
}

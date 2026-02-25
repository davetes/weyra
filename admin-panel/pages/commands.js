import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Badge from "../components/Badge";
import { saveToken } from "../lib/auth";
import { IconTerminal, IconUsers } from "../components/Icons";

const ADMIN_COMMANDS = [
  { cmd: "/admin or /help", desc: "Show available commands" },
  { cmd: "/username <new_username>", desc: "Change your username" },
  { cmd: "/present", desc: "Register present for daily bonus" },
  { cmd: "/top10", desc: "Show top 10 players overall" },
  { cmd: "/topdaily", desc: "Show top 10 players today" },
  { cmd: "/topweekly", desc: "Show top 10 players this week" },
  {
    cmd: "/post <message|photo|file|playnow>",
    desc: "Broadcast message to channel",
  },
];

const ENTERTAINER_COMMANDS = [
  {
    cmd: "/balances <id|@username>",
    desc: "Check player wallet + gift balance",
  },
  { cmd: "/add <id|@username> <amount>", desc: "Add amount to player wallet" },
  {
    cmd: "/subtract <id|@username> <amount>",
    desc: "Subtract amount from wallet",
  },
  { cmd: "/roles", desc: "Show available admin roles" },
];

export default function CommandsPage() {
  return (
    <RequireAuth>
      {({ admin }) => (
        <AdminShell
          admin={admin}
          title="Bot Commands"
          onLogout={() => {
            saveToken(null);
            window.location.href = "/login";
          }}
        >
          <div className="space-y-5">
            <div className="grid lg:grid-cols-2 gap-5">
              <Card title="Player Commands" icon={IconUsers}>
                <div className="space-y-3">
                  {" "}
                  {ADMIN_COMMANDS.map((item, i) => (
                    <div
                      key={i}
                      className="border border-border rounded-xl p-3.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-mono text-sm font-medium text-accent-light break-all flex-1">
                          {" "}
                          {item.cmd}{" "}
                        </div>{" "}
                        <Badge variant="accent" dot>
                          {" "}
                          Player{" "}
                        </Badge>{" "}
                      </div>{" "}
                      <p className="text-xs text-muted mt-1.5">
                        {" "}
                        {item.desc}{" "}
                      </p>{" "}
                    </div>
                  ))}{" "}
                </div>{" "}
              </Card>{" "}
              <Card title="Entertainer Commands" icon={IconTerminal}>
                <div className="space-y-3">
                  {" "}
                  {ENTERTAINER_COMMANDS.map((item, i) => (
                    <div
                      key={i}
                      className="border border-border rounded-xl p-3.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-mono text-sm font-medium text-accent-light break-all flex-1">
                          {" "}
                          {item.cmd}{" "}
                        </div>{" "}
                        <Badge variant="warning" dot>
                          {" "}
                          Entertainer{" "}
                        </Badge>{" "}
                      </div>{" "}
                      <p className="text-xs text-muted mt-1.5">
                        {" "}
                        {item.desc}{" "}
                      </p>{" "}
                    </div>
                  ))}{" "}
                </div>{" "}
              </Card>{" "}
            </div>{" "}
            <Card title="About Bot Commands">
              <div className="space-y-2 text-sm text-muted">
                <p>
                  {" "}
                  Bot commands are used by players and admin users to interact
                  with the Weyra Bingo game through Telegram.{" "}
                </p>{" "}
                <p>
                  {" "}
                  <strong className="text-slate-300">
                    {" "}
                    Player Commands:{" "}
                  </strong>{" "}
                  Available to all players in the game
                </p>
                <p>
                  {" "}
                  <strong className="text-slate-300">
                    {" "}
                    Entertainer Commands:{" "}
                  </strong>{" "}
                  Available only to users with the{" "}
                  <Badge variant="warning">Entertainer</Badge> role{" "}
                </p>{" "}
              </div>{" "}
            </Card>{" "}
          </div>{" "}
        </AdminShell>
      )}
    </RequireAuth>
  );
}

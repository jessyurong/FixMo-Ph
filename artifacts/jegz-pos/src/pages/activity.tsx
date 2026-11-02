import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActivityLogs, activityService } from "@/lib/offline-api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Search, Trash2 } from "lucide-react";

type Category = "all" | "auth" | "transaction" | "drawer" | "backup" | "user";

const CATEGORY_OF = (action: string): Exclude<Category, "all"> => {
  if (action === "login" || action === "logout") return "auth";
  if (action.startsWith("transaction.")) return "transaction";
  if (action.startsWith("drawer.")) return "drawer";
  if (action.startsWith("backup.")) return "backup";
  if (action.startsWith("user.")) return "user";
  return "transaction";
};

const ACTION_STYLE: Record<string, string> = {
  "transaction.delete": "bg-red-600 text-white",
  "transaction.cancel": "bg-slate-500 text-white",
  "transaction.complete": "bg-green-600 text-white",
  "drawer.withdraw": "bg-red-500 text-white",
  "drawer.deposit": "bg-blue-600 text-white",
  "backup.restore": "bg-amber-600 text-white",
  "user.delete": "bg-red-600 text-white",
};

export default function ActivityPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: logs = [], isLoading, refetch } = useActivityLogs(300);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("all");

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    return logs.filter((log) => {
      if (category !== "all" && CATEGORY_OF(log.action) !== category) return false;
      if (!term) return true;
      return [log.username, log.action, log.summary, log.entityId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [logs, search, category]);

  if (!user || user.role !== "admin") {
    return (
      <div className="mx-auto max-w-md space-y-4 pt-16 text-center">
        <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-bold">Restricted area</h1>
        <p className="text-sm text-muted-foreground">
          The activity log is available to administrators only.
        </p>
      </div>
    );
  }

  const handleClear = async () => {
    if (!confirm("Clear all activity logs? This cannot be undone.")) return;
    try {
      await activityService.clear();
      queryClient.invalidateQueries({ queryKey: ["activityLogs"] });
      refetch();
      toast({ title: "Activity log cleared" });
    } catch {
      toast({ title: "Could not clear log", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 flex flex-col h-[calc(100vh-2rem)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
          <ClipboardList className="h-6 w-6" />
          Activity Log
        </h1>
        <Button variant="ghost" size="sm" className="gap-2 text-destructive" onClick={handleClear}>
          <Trash2 className="h-4 w-4" /> Clear log
        </Button>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="py-3 px-4 border-b flex flex-row flex-wrap items-center gap-3 shrink-0">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by user, action, or summary..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="auth">Login / Logout</SelectItem>
              <SelectItem value="transaction">Transactions</SelectItem>
              <SelectItem value="drawer">Drawer</SelectItem>
              <SelectItem value="backup">Backup</SelectItem>
              <SelectItem value="user">Users</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4">
            {isLoading ? (
              <div className="text-center py-8">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {logs.length === 0
                  ? "No activity recorded yet. Actions taken from now on will appear here."
                  : "No activity matches your filter."}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((log) => (
                  <Card key={log.id} className="overflow-hidden">
                    <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm">{log.username}</span>
                          {log.userRole && (
                            <Badge variant="outline" className="text-xs capitalize">
                              {log.userRole}
                            </Badge>
                          )}
                          <Badge className={ACTION_STYLE[log.action] || "bg-primary text-primary-foreground"}>
                            {log.action}
                          </Badge>
                        </div>
                        <p className="text-sm mt-1">{log.summary}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDate(log.createdAt)}
                          {log.details ? ` · ${log.details}` : ""}
                        </p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground shrink-0">
        Showing {filtered.length} of {logs.length} latest records · {logs.length >= 300 ? "older entries are trimmed from this view" : "stored on this device only"}
      </p>
    </div>
  );
}

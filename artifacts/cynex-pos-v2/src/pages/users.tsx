import { useState, useEffect } from "react";
import bcrypt from "bcryptjs";
import { useAuth, ALL_PERMISSIONS, type Permission } from "@/lib/auth-context";
import { localDb } from "@/lib/local-db";
import { activityService } from "@/lib/offline-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, Shield, ShieldCheck, ShieldOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type AppUser = {
  id: number;
  username: string;
  role: "admin" | "staff";
  permissions: string[];
  isActive: boolean;
  createdAt: string;
};

const PERMISSION_LABELS: Record<Permission, string> = {
  pos: "Point of Sale",
  inventory: "Inventory",
  services: "Labor Services",
  technicians: "Technicians",
  transactions: "Transactions",
  cash_drawer: "Cash Drawer",
  gcash_drawer: "GCash Drawer",
  defective_items: "Defective Items",
  backjobs: "Backjobs",
};

export default function UsersPage() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [form, setForm] = useState({
    username: "",
    password: "",
    role: "staff" as "admin" | "staff",
    permissions: [] as string[],
    isActive: true,
  });

  const loadUsers = async () => {
    setLoading(true);
    try {
      const all = await localDb.users.toArray();
      const mapped: AppUser[] = all.map((u: any) => ({
        id: u.id,
        username: u.username,
        role: u.role || "staff",
        permissions: u.permissions || [],
        isActive: u.isActive !== false,
        createdAt: u.createdAt || "",
      }));
      setUsers(mapped);
    } catch (e) {
      console.error("Failed to load users:", e);
    }
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, []);

  const openAdd = () => {
    setEditingUser(null);
    setForm({ username: "", password: "", role: "staff", permissions: [], isActive: true });
    setModalOpen(true);
  };

  const openEdit = (u: AppUser) => {
    setEditingUser(u);
    setForm({ username: u.username, password: "", role: u.role, permissions: [...u.permissions], isActive: u.isActive });
    setModalOpen(true);
  };

  const togglePermission = (perm: string) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(perm)
        ? f.permissions.filter(p => p !== perm)
        : [...f.permissions, perm],
    }));
  };

  const handleSave = async () => {
    if (!editingUser && (!form.username || !form.password)) {
      toast({ title: "Username and password are required", variant: "destructive" });
      return;
    }
    if (!editingUser && form.password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }

    try {
      if (!editingUser) {
        const existing = await localDb.users.where("username").equalsIgnoreCase(form.username).first();
        if (existing) {
          toast({ title: "Username already exists", variant: "destructive" });
          return;
        }
        const passwordHash = await bcrypt.hash(form.password, 10);
        await localDb.users.add({
          username: form.username,
          passwordHash,
          role: form.role,
          permissions: form.role === "admin" ? ["*"] : form.permissions,
          isActive: form.isActive,
          createdAt: new Date().toISOString(),
        } as any);
        toast({ title: "User created" });
        void activityService.log("user.create", `Created user "${form.username}" (${form.role})`, {
          entityType: "user", entityId: form.username,
        });
      } else {
        const updateFields: any = {
          role: form.role,
          permissions: form.role === "admin" ? ["*"] : form.permissions,
          isActive: form.isActive,
        };
        if (form.password) {
          updateFields.passwordHash = await bcrypt.hash(form.password, 10);
        }
        await localDb.users.update(editingUser.id, updateFields);
        toast({ title: "User updated" });
        void activityService.log("user.update", `Updated user "${editingUser.username}"`, {
          entityType: "user", entityId: editingUser.id,
        });
      }
      setModalOpen(false);
      loadUsers();
    } catch (e) {
      console.error("Failed to save user:", e);
      toast({ title: "Failed to save user", variant: "destructive" });
    }
  };

  const handleDelete = async (u: AppUser) => {
    if (u.id === me?.id) { toast({ title: "Cannot delete your own account", variant: "destructive" }); return; }
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      await localDb.users.delete(u.id);
      toast({ title: "User deleted" });
      void activityService.log("user.delete", `Deleted user "${u.username}"`, {
        entityType: "user", entityId: u.id,
      });
      loadUsers();
    } catch (e) {
      console.error("Failed to delete user:", e);
      toast({ title: "Failed to delete user", variant: "destructive" });
    }
  };

  const toggleActive = async (u: AppUser) => {
    if (u.id === me?.id) { toast({ title: "Cannot deactivate your own account", variant: "destructive" }); return; }
    try {
      await localDb.users.update(u.id, { isActive: !u.isActive });
      toast({ title: u.isActive ? "User deactivated" : "User activated" });
      void activityService.log("user.status", `${u.isActive ? "Deactivated" : "Activated"} user "${u.username}"`, {
        entityType: "user", entityId: u.id,
      });
      loadUsers();
    } catch (e) {
      console.error("Failed to toggle user:", e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-primary">User Management</h1>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Add User
        </Button>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <CardTitle className="text-sm text-muted-foreground">
            {users.length} user{users.length !== 1 ? "s" : ""} in the system
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : users.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-semibold">
                    {u.username}
                    {u.id === me?.id && <Badge variant="outline" className="ml-2 text-xs">You</Badge>}
                  </TableCell>
                  <TableCell>
                    {u.role === "admin"
                      ? <Badge className="bg-primary gap-1"><ShieldCheck className="h-3 w-3" />Admin</Badge>
                      : <Badge variant="secondary" className="gap-1"><Shield className="h-3 w-3" />Staff</Badge>
                    }
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    {u.role === "admin"
                      ? <span className="text-sm text-muted-foreground">Full access</span>
                      : u.permissions.length === 0
                        ? <span className="text-sm text-destructive/70">No access assigned</span>
                        : <div className="flex flex-wrap gap-1">
                            {u.permissions.map(p => (
                              <Badge key={p} variant="outline" className="text-xs">{PERMISSION_LABELS[p as Permission] || p}</Badge>
                            ))}
                          </div>
                    }
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={u.isActive}
                      onCheckedChange={() => toggleActive(u)}
                      disabled={u.id === me?.id}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(u)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="text-destructive hover:bg-destructive/20"
                        onClick={() => handleDelete(u)}
                        disabled={u.id === me?.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? `Edit: ${editingUser.username}` : "Add New User"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editingUser && (
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="e.g. juana"
                  autoFocus
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>{editingUser ? "New Password (leave blank to keep current)" : "Password"}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Min. 6 characters"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff"><Shield className="h-3 w-3 inline mr-1" />Staff</SelectItem>
                  <SelectItem value="admin"><ShieldCheck className="h-3 w-3 inline mr-1" />Admin (full access)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.role === "staff" && (
              <div className="space-y-3">
                <Label className="text-sm font-semibold">Page Access</Label>
                <div className="grid grid-cols-2 gap-2 p-3 bg-muted/30 rounded-lg border">
                  {ALL_PERMISSIONS.map(perm => (
                    <label key={perm} className="flex items-center gap-2 cursor-pointer text-sm py-1">
                      <Switch
                        checked={form.permissions.includes(perm)}
                        onCheckedChange={() => togglePermission(perm)}
                      />
                      <span>{PERMISSION_LABELS[perm]}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {editingUser && (
              <div className="flex items-center gap-3 pt-2 border-t">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
                  disabled={editingUser.id === me?.id}
                />
                <Label className={!form.isActive ? "text-destructive" : ""}>
                  Account {form.isActive ? "Active" : "Disabled"}
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save User</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { useShopProfile } from "@/lib/offline-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Wrench, Lock, User } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const shopProfile = useShopProfile();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError("");
    const result = await login(username, password);
    if (result.error) {
      setError(result.error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo / Brand */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-2">
            {shopProfile.logo ? (
              <img src={shopProfile.logo} alt={shopProfile.name} className="w-12 h-12 object-contain" />
            ) : (
              <Wrench className="h-8 w-8 text-primary" />
            )}
          </div>
          <h1 className="text-2xl font-black text-primary tracking-tight">{shopProfile.name}</h1>
          <p className="text-sm text-muted-foreground">{shopProfile.description || "Point of Sale System"}</p>
        </div>

        {/* Login Card */}
        <Card className="border-border bg-card shadow-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" /> Sign In
            </CardTitle>
            <CardDescription>Enter your credentials to access the system</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="Enter username"
                    className="pl-9"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    className="pl-9"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full font-bold h-11"
                disabled={loading || !username || !password}
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Contact admin if you forgot your password
        </p>
      </div>
    </div>
  );
}
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPostJson, setStoredTokens } from "@/lib/api-client";
import { STORE_LOGO_ALT, STORE_LOGO_PATH } from "@/lib/brand";

type LoginResponse = {
  user: { id: string; email: string; name: string | null; role: string };
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
};

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const redirect = params.get("redirect") || "/dashboard/inventory";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await apiPostJson<LoginResponse>("/api/v1/auth/login", {
        email,
        password,
      });
      setStoredTokens(data.tokens.accessToken, data.tokens.refreshToken);
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="brand-page-bg flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md overflow-hidden border-primary/20 shadow-lg shadow-primary/5">
        <div className="h-1 brand-header-accent" aria-hidden />
        <CardHeader className="items-center text-center">
          <img
            src={STORE_LOGO_PATH}
            alt={STORE_LOGO_ALT}
            className="mb-2 h-16 max-w-56 object-contain dark:invert"
          />
          <CardTitle className="text-xl tracking-tight">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full rounded-xl" disabled={loading}>
              {loading ? "Signing in…" : "Continue"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <Link to="/dashboard" className="underline underline-offset-4 hover:text-foreground">
                Back to dashboard
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Loopline Execution" },
      { name: "description", content: "Sign in to Loopline to execute verified Bybit spot arbitrage routes with full audit history." },
      { property: "og:title", content: "Sign in — Loopline Execution" },
      { property: "og:description", content: "Sign in to Loopline to execute verified Bybit spot arbitrage routes with full audit history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (signUpError) throw signUpError;
        setMessage("Account created. If email confirmation is on, confirm it and sign in.");
        setMode("signin");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        void navigate({ to: "/" });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-16">
      <div className="panel w-full max-w-md rounded-lg p-6">
        <div className="eyebrow">Loopline</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {user ? "You're signed in" : mode === "signin" ? "Sign in to execute" : "Create an account"}
        </h1>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Execution requires an authenticated account: every order is placed server-side and written to your private audit trail.
        </p>

        {authLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Checking session…</p>
        ) : user ? (
          <div className="mt-6 space-y-3">
            <div className="rounded-md bg-surface-subtle px-3 py-2 font-mono text-xs text-foreground">{user.email}</div>
            <Button className="w-full" onClick={() => void navigate({ to: "/" })}>Back to scanner</Button>
            <Button variant="outline" className="w-full" onClick={() => void signOut()}>Sign out</Button>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-foreground">Email</span>
              <input
                className="input-control h-10 w-full rounded-md px-3 text-sm"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-foreground">Password</span>
              <input
                className="input-control h-10 w-full rounded-md px-3 text-sm"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <div className="rounded-md border border-coral/30 bg-coral/10 p-3 text-xs text-coral">{error}</div>}
            {message && <div className="rounded-md border border-primary/30 bg-accent p-3 text-xs text-primary">{message}</div>}
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); setMessage(null); }}
            >
              {mode === "signin" ? "No account? Create one" : "Already have an account? Sign in"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

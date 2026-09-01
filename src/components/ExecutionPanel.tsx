import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Info, Loader2, Lock, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { executeNextLeg, startExecution, type ExecutionMode, type LegInput, type RunState } from "@/lib/execution.functions";

type PanelLeg = { symbol: string; from: string; to: string; side: "Sell" | "Buy" | "Convert" };

const STATUS_TONE: Record<string, string> = {
  pending: "text-muted-foreground",
  submitting: "text-warning",
  filled: "text-primary",
  failed: "text-coral",
  skipped: "text-muted-foreground",
};

/**
 * User-entered amount, explicit confirmation, then a sequential per-leg run
 * driven one server call at a time so progress and failures stay visible.
 */
export function ExecutionPanel({
  startCoin,
  legs,
  netEdge,
  mode,
}: {
  startCoin: string;
  legs: PanelLeg[];
  netEdge: number;
  mode: ExecutionMode;
}) {
  const { user, loading: authLoading } = useAuth();
  const start = useServerFn(startExecution);
  const step = useServerFn(executeNextLeg);

  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasConvert = legs.some((leg) => leg.side === "Convert");
  const parsedAmount = Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  useEffect(() => {
    setRun(null);
    setError(null);
    setConfirming(false);
  }, [startCoin, legs.map((leg) => leg.symbol).join("|")]);

  async function execute() {
    setConfirming(false);
    setRunning(true);
    setError(null);
    setRun(null);
    try {
      const started = await start({
        data: {
          startCoin,
          amount: parsedAmount,
          legs: legs.map((leg) => ({ symbol: leg.symbol, from: leg.from, to: leg.to, side: leg.side as "Buy" | "Sell" })) as LegInput[],
          mode,
          // Guard against the edge collapsing between scan and execution.
          minNetEdge: Math.max(0, netEdge * 0.5),
          confirmed: true,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (!started.ok) {
        setError(started.reason);
        return;
      }
      let current = started.run;
      setRun(current);

      // One call per leg; bounded so a stuck run can never spin forever.
      for (let guard = 0; guard < legs.length + 2; guard += 1) {
        const next = await step({ data: { runId: current.id } });
        if (!next.ok) {
          setError(next.reason);
          return;
        }
        current = next.run;
        setRun(current);
        if (next.done || current.status === "failed" || current.status === "completed") break;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Execution failed.");
    } finally {
      setRunning(false);
    }
  }

  if (authLoading) {
    return <div className="mt-4 rounded-md border border-border p-4 text-xs text-muted-foreground">Checking session…</div>;
  }

  if (!user) {
    return (
      <div className="mt-4 flex flex-col gap-3 rounded-md border border-border bg-surface-subtle p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Lock className="h-4 w-4 text-primary" /> Sign in to execute</div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          Orders are placed server-side with your Bybit keys and recorded to a private audit trail, so execution needs an authenticated account.
        </p>
        <Button asChild size="sm" className="w-fit"><Link to="/auth">Sign in</Link></Button>
      </div>
    );
  }

  if (hasConvert) {
    return (
      <div className="mt-4 flex gap-2 rounded-md border border-warning/25 bg-warning/10 p-3 text-[11px] leading-4 text-warning">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>This route contains Bybit Convert legs, which cannot be executed automatically. Only pure spot Buy/Sell cycles are executable.</span>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-foreground">Execute this route</div>
        <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${mode === "demo" ? "text-warning" : "text-primary"}`}>{mode}</span>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="mb-2 block text-[11px] text-muted-foreground">Amount to trade ({startCoin})</span>
          <input
            className="input-control mono h-10 w-full rounded-md px-3 text-sm"
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            disabled={running}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <Button className="h-10" disabled={!amountValid || running} onClick={() => setConfirming(true)}>
          {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Executing…</> : "Execute"}
        </Button>
      </div>

      {confirming && (
        <div className="mt-3 rounded-md border border-coral/30 bg-coral/10 p-3 text-[11px] leading-4 text-coral">
          <div className="font-medium">
            Confirm {mode === "demo" ? "demo" : "LIVE"} execution of {amount} {startCoin} across {legs.length} spot legs?
          </div>
          <div className="mt-1 text-coral/80">
            The server re-prices the route before placing anything and aborts if the edge collapses. Orders are market orders and may slip.
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void execute()}>Yes, execute</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {error && <div className="mt-3 rounded-md border border-coral/30 bg-coral/10 p-3 text-[11px] text-coral">{error}</div>}

      {run && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Run status</span>
            <span className={`font-mono uppercase ${run.status === "completed" ? "text-primary" : run.status === "failed" ? "text-coral" : "text-warning"}`}>{run.status}</span>
          </div>
          {run.legs.map((leg) => (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-subtle px-3 py-2 text-[11px]" key={leg.id}>
              <span className="font-mono text-foreground">
                {String(leg.sequence).padStart(2, "0")} · {leg.side.toUpperCase()} {leg.symbol} ({leg.fromCoin} → {leg.toCoin})
              </span>
              <span className={`font-mono ${STATUS_TONE[leg.status] ?? "text-muted-foreground"}`}>
                {leg.status}
                {leg.received !== null ? ` · ${leg.received} ${leg.toCoin}` : ""}
              </span>
              {leg.errorMessage && <span className="w-full text-coral">{leg.errorMessage}</span>}
            </div>
          ))}
          {run.failureReason && (
            <div className="flex gap-2 rounded-md border border-coral/30 bg-coral/10 p-3 text-[11px] text-coral">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{run.failureReason} Remaining legs were skipped — your balance is sitting in the last coin that filled.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

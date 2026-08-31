/**
 * Authenticated Bybit spot execution.
 *
 * Every entry point requires a signed-in Supabase user, re-validates the route
 * against live Bybit quotes on the server, and writes an audit trail to
 * `loopline_execution_runs` / `loopline_execution_legs` under the caller's RLS.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ExecutionMode = "live" | "demo";

export type LegInput = { symbol: string; from: string; to: string; side: "Buy" | "Sell" };

export type LegState = {
  id: string;
  sequence: number;
  symbol: string;
  fromCoin: string;
  toCoin: string;
  side: string;
  status: string;
  orderId: string | null;
  /** Amount received in `toCoin` after fees. */
  received: number | null;
  averagePrice: number | null;
  errorMessage: string | null;
};

export type RunState = {
  id: string;
  status: string;
  mode: string;
  startCoin: string;
  requestedAmount: number;
  failureReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  legs: LegState[];
};

export type StartResult = { ok: true; run: RunState } | { ok: false; reason: string };
export type StepResult = { ok: true; run: RunState; done: boolean } | { ok: false; reason: string };

/** Hard server-side ceiling on a single run, independent of anything the client sends. */
const MAX_LEGS = 6;
const MIN_LEGS = 3;

const maxNotional = () => {
  const configured = Number(process.env["EXECUTION_MAX_NOTIONAL"]);
  return Number.isFinite(configured) && configured > 0 ? configured : 500;
};

const COIN = /^[A-Z0-9]{2,16}$/;
const SYMBOL = /^[A-Z0-9]{4,32}$/;

function validateRoute(legs: unknown, startCoin: string): LegInput[] {
  if (!Array.isArray(legs) || legs.length < MIN_LEGS || legs.length > MAX_LEGS) {
    throw new Error(`A route must have between ${MIN_LEGS} and ${MAX_LEGS} legs.`);
  }
  const parsed: LegInput[] = legs.map((raw) => {
    const leg = raw as Partial<LegInput>;
    const symbol = String(leg.symbol ?? "").toUpperCase();
    const from = String(leg.from ?? "").toUpperCase();
    const to = String(leg.to ?? "").toUpperCase();
    const side = leg.side;
    if (side !== "Buy" && side !== "Sell") {
      throw new Error("Only spot Buy/Sell legs can be executed — Convert legs are not supported.");
    }
    if (!SYMBOL.test(symbol) || !COIN.test(from) || !COIN.test(to) || from === to) {
      throw new Error("The route contains an invalid leg.");
    }
    return { symbol, from, to, side };
  });

  // The cycle must be continuous and must close back onto the start coin.
  let cursor = startCoin;
  for (const leg of parsed) {
    if (leg.from !== cursor) throw new Error("The route legs are not continuous.");
    cursor = leg.to;
  }
  if (cursor !== startCoin) throw new Error("The route does not close back onto the start coin.");
  if (new Set(parsed.map((leg) => leg.symbol)).size !== parsed.length) {
    throw new Error("The route reuses the same market twice.");
  }
  return parsed;
}

const toRunState = (
  run: {
    id: string;
    status: string;
    mode: string;
    start_coin: string;
    requested_amount: number;
    failure_reason: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  },
  legs: Array<{
    id: string;
    sequence: number;
    symbol: string;
    from_coin: string;
    to_coin: string;
    side: string;
    status: string;
    order_id: string | null;
    filled_quantity: number | null;
    average_price: number | null;
    error_message: string | null;
  }>,
): RunState => ({
  id: run.id,
  status: run.status,
  mode: run.mode,
  startCoin: run.start_coin,
  requestedAmount: Number(run.requested_amount),
  failureReason: run.failure_reason,
  startedAt: run.started_at,
  completedAt: run.completed_at,
  createdAt: run.created_at,
  legs: legs
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((leg) => ({
      id: leg.id,
      sequence: leg.sequence,
      symbol: leg.symbol,
      fromCoin: leg.from_coin,
      toCoin: leg.to_coin,
      side: leg.side,
      status: leg.status,
      orderId: leg.order_id,
      received: leg.filled_quantity === null ? null : Number(leg.filled_quantity),
      averagePrice: leg.average_price === null ? null : Number(leg.average_price),
      errorMessage: leg.error_message,
    })),
});

type Supa = { supabase: Awaited<ReturnType<typeof import("@/integrations/supabase/auth-middleware")["requireSupabaseAuth"]>> };

async function loadRun(supabase: any, runId: string): Promise<RunState | null> {
  const [{ data: run }, { data: legs }] = await Promise.all([
    supabase.from("loopline_execution_runs").select("*").eq("id", runId).maybeSingle(),
    supabase.from("loopline_execution_legs").select("*").eq("run_id", runId),
  ]);
  if (!run) return null;
  return toRunState(run, legs ?? []);
}

export const startExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      startCoin: string;
      amount: number;
      legs: LegInput[];
      mode?: ExecutionMode;
      minNetEdge: number;
      confirmed: boolean;
      idempotencyKey: string;
    }) => {
      if (input?.confirmed !== true) throw new Error("Execution must be explicitly confirmed.");
      const startCoin = String(input.startCoin ?? "").toUpperCase();
      if (!COIN.test(startCoin)) throw new Error("Invalid start coin.");
      const amount = Number(input.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount greater than zero.");
      const minNetEdge = Number(input.minNetEdge);
      const idempotencyKey = String(input.idempotencyKey ?? "");
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(idempotencyKey)) throw new Error("Invalid idempotency key.");
      const mode: ExecutionMode = input.mode === "demo" ? "demo" : "live";
      return {
        startCoin,
        amount,
        legs: validateRoute(input.legs, startCoin),
        mode,
        minNetEdge: Number.isFinite(minNetEdge) ? minNetEdge : 0,
        idempotencyKey,
      };
    },
  )
  .handler(async ({ data, context }): Promise<StartResult> => {
    const { supabase, userId } = context;
    const { readBybitCredentials } = await import("./bybit.server");
    const { fetchSymbolRules, fetchTickerMap } = await import("./execution.server");

    if (data.amount > maxNotional()) {
      return { ok: false, reason: `Amount exceeds the per-run ceiling of ${maxNotional()} ${data.startCoin}.` };
    }
    if (!readBybitCredentials(data.mode)) {
      return { ok: false, reason: `Bybit ${data.mode} API credentials are not configured on the server.` };
    }

    // Only one run may be in flight per user — prevents concurrent double spends.
    const { data: inflight } = await supabase
      .from("loopline_execution_runs")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["pending", "running"])
      .limit(1);
    if (inflight && inflight.length > 0) {
      return { ok: false, reason: "Another execution is still in flight. Wait for it to finish first." };
    }

    // Idempotency: replay the existing run instead of creating a second one.
    const { data: existing } = await supabase
      .from("loopline_execution_runs")
      .select("id")
      .eq("user_id", userId)
      .eq("idempotency_key", data.idempotencyKey)
      .maybeSingle();
    if (existing) {
      const run = await loadRun(supabase, existing.id);
      if (run) return { ok: true, run };
    }

    // Re-price the route server-side: the client's numbers are never trusted.
    const symbols = data.legs.map((leg) => leg.symbol);
    let rules: Awaited<ReturnType<typeof fetchSymbolRules>>;
    let tickers: Awaited<ReturnType<typeof fetchTickerMap>>;
    try {
      [rules, tickers] = await Promise.all([fetchSymbolRules(symbols), fetchTickerMap(symbols)]);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "Could not verify the route against Bybit." };
    }

    let product = 1;
    for (const leg of data.legs) {
      const rule = rules.get(leg.symbol);
      const quote = tickers.get(leg.symbol);
      if (!rule || rule.status !== "Trading") return { ok: false, reason: `${leg.symbol} is not currently trading on Bybit spot.` };
      if (!quote || quote.bid <= 0 || quote.ask <= 0) return { ok: false, reason: `No live quote for ${leg.symbol}.` };
      const expected = leg.side === "Sell" ? { from: rule.baseCoin, to: rule.quoteCoin } : { from: rule.quoteCoin, to: rule.baseCoin };
      if (expected.from !== leg.from || expected.to !== leg.to) {
        return { ok: false, reason: `${leg.symbol} does not convert ${leg.from} into ${leg.to}.` };
      }
      product *= leg.side === "Sell" ? quote.bid : 1 / quote.ask;
    }

    // Fees are charged per spot leg; use a conservative taker assumption for the guard.
    const netEdge = product * Math.pow(1 - 0.001, data.legs.length) - 1;
    const floor = Math.max(0, data.minNetEdge);
    if (netEdge < floor) {
      return {
        ok: false,
        reason: `The edge collapsed before execution: ${(netEdge * 100).toFixed(3)}% net now, below your ${(floor * 100).toFixed(3)}% floor.`,
      };
    }

    const { data: run, error: runError } = await supabase
      .from("loopline_execution_runs")
      .insert({
        user_id: userId,
        idempotency_key: data.idempotencyKey,
        mode: data.mode,
        start_coin: data.startCoin,
        requested_amount: data.amount,
        route: data.legs as unknown as never,
        status: "pending",
      })
      .select("*")
      .single();
    if (runError || !run) return { ok: false, reason: runError?.message ?? "Could not create the execution run." };

    const { error: legError } = await supabase.from("loopline_execution_legs").insert(
      data.legs.map((leg, index) => ({
        run_id: run.id,
        user_id: userId,
        sequence: index + 1,
        symbol: leg.symbol,
        from_coin: leg.from,
        to_coin: leg.to,
        side: leg.side,
        status: "pending",
      })),
    );
    if (legError) {
      await supabase.from("loopline_execution_runs").update({ status: "failed", failure_reason: legError.message }).eq("id", run.id);
      return { ok: false, reason: legError.message };
    }

    const state = await loadRun(supabase, run.id);
    return state ? { ok: true, run: state } : { ok: false, reason: "Execution run could not be read back." };
  });

/**
 * Execute the next pending leg of a run and return the updated state.
 *
 * One leg per call keeps each request short and lets the UI show sequential
 * per-leg progress; the client loops until the run reaches a terminal status.
 */
export const executeNextLeg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string }) => {
    const runId = String(input?.runId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("Invalid run id.");
    return { runId };
  })
  .handler(async ({ data, context }): Promise<StepResult> => {
    const { supabase, userId } = context;
    const { readBybitCredentials } = await import("./bybit.server");
    const { executeMarketLeg, fetchSymbolRules } = await import("./execution.server");

    // RLS already scopes this to the caller; the explicit user filter is belt and braces.
    const { data: runRow } = await supabase
      .from("loopline_execution_runs")
      .select("*")
      .eq("id", data.runId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!runRow) return { ok: false, reason: "Execution run not found." };

    if (runRow.status === "completed" || runRow.status === "failed") {
      const finished = await loadRun(supabase, data.runId);
      return finished ? { ok: true, run: finished, done: true } : { ok: false, reason: "Execution run not found." };
    }

    const { data: legRows } = await supabase
      .from("loopline_execution_legs")
      .select("*")
      .eq("run_id", data.runId)
      .order("sequence", { ascending: true });
    const legs = legRows ?? [];
    const next = legs.find((leg) => leg.status === "pending");
    if (!next) {
      await supabase
        .from("loopline_execution_runs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", data.runId);
      const finished = await loadRun(supabase, data.runId);
      return finished ? { ok: true, run: finished, done: true } : { ok: false, reason: "Execution run not found." };
    }

    const credentials = readBybitCredentials(runRow.mode === "demo" ? "demo" : "live");
    if (!credentials) {
      await failRun(supabase, data.runId, next.id, legs, "Bybit API credentials are not configured on the server.");
      const failed = await loadRun(supabase, data.runId);
      return failed ? { ok: true, run: failed, done: true } : { ok: false, reason: "Execution run not found." };
    }

    // Carry the realised output of the previous leg; the first leg uses the user amount.
    const previous = legs.filter((leg) => leg.sequence < next.sequence).sort((a, b) => b.sequence - a.sequence)[0];
    const inputAmount = previous ? Number(previous.filled_quantity ?? 0) : Number(runRow.requested_amount);
    if (!Number.isFinite(inputAmount) || inputAmount <= 0) {
      await failRun(supabase, data.runId, next.id, legs, "No balance carried into this leg.");
      const failed = await loadRun(supabase, data.runId);
      return failed ? { ok: true, run: failed, done: true } : { ok: false, reason: "Execution run not found." };
    }

    await supabase
      .from("loopline_execution_runs")
      .update({ status: "running", ...(runRow.started_at ? {} : { started_at: new Date().toISOString() }) })
      .eq("id", data.runId);
    await supabase
      .from("loopline_execution_legs")
      .update({ status: "submitting", requested_quantity: inputAmount })
      .eq("id", next.id);

    try {
      const rules = await fetchSymbolRules([next.symbol]);
      const rule = rules.get(next.symbol);
      if (!rule || rule.status !== "Trading") throw new Error(`${next.symbol} is not trading right now.`);

      const result = await executeMarketLeg(credentials, {
        symbol: next.symbol,
        side: next.side === "Sell" ? "Sell" : "Buy",
        qty: inputAmount,
        // Deterministic per leg: a retry re-attaches instead of placing a second order.
        orderLinkId: `ll${data.runId.replace(/-/g, "").slice(0, 24)}${next.sequence}`,
        rules: rule,
      });

      await supabase
        .from("loopline_execution_legs")
        .update({
          status: "filled",
          order_id: result.orderId,
          filled_quantity: result.received,
          average_price: result.avgPrice,
        })
        .eq("id", next.id);

      const isLast = next.sequence === legs.length;
      if (isLast) {
        await supabase
          .from("loopline_execution_runs")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", data.runId);
      }

      const state = await loadRun(supabase, data.runId);
      return state ? { ok: true, run: state, done: isLast } : { ok: false, reason: "Execution run not found." };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The leg failed on Bybit.";
      await failRun(supabase, data.runId, next.id, legs, message);
      const failed = await loadRun(supabase, data.runId);
      return failed ? { ok: true, run: failed, done: true } : { ok: false, reason: message };
    }
  });

/** Mark the failing leg, skip everything after it, and halt the run. */
async function failRun(
  supabase: any,
  runId: string,
  legId: string,
  legs: Array<{ id: string; sequence: number; status: string }>,
  message: string,
) {
  const failing = legs.find((leg) => leg.id === legId);
  await supabase.from("loopline_execution_legs").update({ status: "failed", error_message: message }).eq("id", legId);
  const remaining = legs.filter((leg) => failing && leg.sequence > failing.sequence).map((leg) => leg.id);
  if (remaining.length > 0) {
    await supabase.from("loopline_execution_legs").update({ status: "skipped" }).in("id", remaining);
  }
  await supabase
    .from("loopline_execution_runs")
    .update({ status: "failed", failure_reason: message, completed_at: new Date().toISOString() })
    .eq("id", runId);
}

export const getExecutionRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string }) => {
    const runId = String(input?.runId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("Invalid run id.");
    return { runId };
  })
  .handler(async ({ data, context }): Promise<{ run: RunState | null }> => ({
    run: await loadRun(context.supabase, data.runId),
  }));

export const listExecutionRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ runs: RunState[] }> => {
    const { supabase, userId } = context;
    const { data: runs } = await supabase
      .from("loopline_execution_runs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (!runs || runs.length === 0) return { runs: [] };
    const { data: legs } = await supabase
      .from("loopline_execution_legs")
      .select("*")
      .in("run_id", runs.map((run) => run.id));
    return {
      runs: runs.map((run) => toRunState(run, (legs ?? []).filter((leg) => leg.run_id === run.id))),
    };
  });

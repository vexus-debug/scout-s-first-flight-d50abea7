/**
 * Server-only Bybit spot execution primitives.
 *
 * Everything here runs inside server functions: credentials never leave the
 * server runtime and callers only ever receive derived numbers.
 */
import { BybitError, request, type BybitCredentials } from "./bybit.server";

export type ExecutableLeg = {
  sequence: number;
  symbol: string;
  fromCoin: string;
  toCoin: string;
  side: "Buy" | "Sell";
};

export type SymbolRules = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
  basePrecision: number;
  quotePrecision: number;
  minOrderQty: number;
  minOrderAmt: number;
  maxOrderQty: number;
  maxOrderAmt: number;
};

type InstrumentInfo = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
  lotSizeFilter?: {
    basePrecision?: string;
    quotePrecision?: string;
    minOrderQty?: string;
    minOrderAmt?: string;
    maxOrderQty?: string;
    maxOrderAmt?: string;
  };
};

const num = (value: string | undefined, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Public instrument metadata — no credentials needed, so it uses the public endpoint. */
export async function fetchSymbolRules(symbols: string[]): Promise<Map<string, SymbolRules>> {
  const response = await fetch("https://api.bybit.com/v5/market/instruments-info?category=spot", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Could not read Bybit instrument rules.");
  const json = (await response.json()) as { retCode: number; result: { list: InstrumentInfo[] } };
  if (json.retCode !== 0) throw new Error("Bybit rejected the instrument-rules request.");

  const wanted = new Set(symbols);
  const rules = new Map<string, SymbolRules>();
  for (const item of json.result.list ?? []) {
    if (!wanted.has(item.symbol)) continue;
    rules.set(item.symbol, {
      symbol: item.symbol,
      baseCoin: item.baseCoin,
      quoteCoin: item.quoteCoin,
      status: item.status,
      basePrecision: num(item.lotSizeFilter?.basePrecision, 0.00000001),
      quotePrecision: num(item.lotSizeFilter?.quotePrecision, 0.00000001),
      minOrderQty: num(item.lotSizeFilter?.minOrderQty),
      minOrderAmt: num(item.lotSizeFilter?.minOrderAmt),
      maxOrderQty: num(item.lotSizeFilter?.maxOrderQty, Number.MAX_SAFE_INTEGER),
      maxOrderAmt: num(item.lotSizeFilter?.maxOrderAmt, Number.MAX_SAFE_INTEGER),
    });
  }
  return rules;
}

/** Public top-of-book snapshot used for the server-side edge re-check. */
export async function fetchTickerMap(symbols: string[]) {
  const response = await fetch("https://api.bybit.com/v5/market/tickers?category=spot", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Could not read Bybit quotes.");
  const json = (await response.json()) as {
    retCode: number;
    result: { list: Array<{ symbol: string; bid1Price: string; ask1Price: string }> };
  };
  if (json.retCode !== 0) throw new Error("Bybit rejected the quote request.");
  const wanted = new Set(symbols);
  const map = new Map<string, { bid: number; ask: number }>();
  for (const item of json.result.list ?? []) {
    if (!wanted.has(item.symbol)) continue;
    map.set(item.symbol, { bid: num(item.bid1Price), ask: num(item.ask1Price) });
  }
  return map;
}

/** Floor `value` onto the exchange step so Bybit never rejects the quantity. */
export function floorToStep(value: number, step: number) {
  if (!Number.isFinite(step) || step <= 0) return value;
  const decimals = Math.max(0, Math.min(12, Math.round(-Math.log10(step))));
  const floored = Math.floor(value / step) * step;
  return Number(floored.toFixed(decimals));
}

type OrderSnapshot = {
  orderId: string;
  orderStatus: string;
  cumExecQty: number;
  cumExecValue: number;
  cumExecFee: number;
  avgPrice: number;
};

const parseOrder = (order: {
  orderId: string;
  orderStatus: string;
  cumExecQty?: string;
  cumExecValue?: string;
  cumExecFee?: string;
  avgPrice?: string;
}): OrderSnapshot => ({
  orderId: order.orderId,
  orderStatus: order.orderStatus,
  cumExecQty: num(order.cumExecQty),
  cumExecValue: num(order.cumExecValue),
  cumExecFee: num(order.cumExecFee),
  avgPrice: num(order.avgPrice),
});

/** Bybit codes worth retrying: timeouts, rate limits, and transient system errors. */
const RETRYABLE_RET_CODES = new Set([10002, 10006, 10016, 10429, 130150, 131204, 170007]);
const isRetryable = (error: unknown) => {
  if (error instanceof BybitError) {
    return RETRYABLE_RET_CODES.has(error.retCode) || error.httpStatus >= 500 || error.httpStatus === 429;
  }
  // Network-level failures (fetch rejection) are safe to retry before an order exists.
  return error instanceof Error && !/Unauthorized|Invalid/i.test(error.message);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findOrderByLinkId(credentials: BybitCredentials, symbol: string, orderLinkId: string) {
  for (const path of ["/v5/order/realtime", "/v5/order/history"]) {
    try {
      const result = await request<{ list: Array<Parameters<typeof parseOrder>[0]> }>(credentials, "GET", path, {
        category: "spot",
        symbol,
        orderLinkId,
      });
      const found = result.list?.[0];
      if (found) return parseOrder(found);
    } catch {
      // fall through to the next lookup
    }
  }
  return null;
}

/**
 * Place one spot market order and wait for it to finish filling.
 *
 * `orderLinkId` makes the placement idempotent: Bybit rejects a duplicate, so a
 * retry after an ambiguous failure re-attaches to the original order instead of
 * doubling the position.
 */
export async function executeMarketLeg(
  credentials: BybitCredentials,
  input: {
    symbol: string;
    side: "Buy" | "Sell";
    /** Quantity in base coin for Sell, in quote coin for Buy. */
    qty: number;
    orderLinkId: string;
    rules: SymbolRules;
  },
): Promise<{ orderId: string; received: number; filledQty: number; avgPrice: number }> {
  const qtyStep = input.side === "Sell" ? input.rules.basePrecision : input.rules.quotePrecision;
  const qty = floorToStep(input.qty, qtyStep);
  if (qty <= 0) throw new Error(`Quantity for ${input.symbol} rounds to zero at the exchange step.`);
  if (input.side === "Sell" && input.rules.minOrderQty > 0 && qty < input.rules.minOrderQty) {
    throw new Error(`${input.symbol}: ${qty} is below Bybit's minimum order quantity (${input.rules.minOrderQty}).`);
  }
  if (input.side === "Buy" && input.rules.minOrderAmt > 0 && qty < input.rules.minOrderAmt) {
    throw new Error(`${input.symbol}: ${qty} ${input.rules.quoteCoin} is below Bybit's minimum order amount (${input.rules.minOrderAmt}).`);
  }
  if (input.side === "Sell" && qty > input.rules.maxOrderQty) {
    throw new Error(`${input.symbol}: quantity exceeds Bybit's maximum order size.`);
  }
  if (input.side === "Buy" && qty > input.rules.maxOrderAmt) {
    throw new Error(`${input.symbol}: amount exceeds Bybit's maximum order size.`);
  }

  const payload = {
    category: "spot",
    symbol: input.symbol,
    side: input.side,
    orderType: "Market",
    qty: String(qty),
    marketUnit: input.side === "Sell" ? "baseCoin" : "quoteCoin",
    timeInForce: "IOC",
    orderLinkId: input.orderLinkId,
  };

  let orderId: string | null = null;
  let lastError: unknown = null;
  // Bounded retries: three placement attempts, then give up and let the caller halt the run.
  for (let attempt = 0; attempt < 3 && !orderId; attempt += 1) {
    try {
      const result = await request<{ orderId: string }>(credentials, "POST", "/v5/order/create", payload);
      orderId = result.orderId;
    } catch (error) {
      lastError = error;
      // Duplicate orderLinkId means the previous attempt landed — adopt that order.
      const existing = await findOrderByLinkId(credentials, input.symbol, input.orderLinkId);
      if (existing) {
        orderId = existing.orderId;
        break;
      }
      if (!isRetryable(error) || attempt === 2) break;
      await sleep(400 * (attempt + 1));
    }
  }

  if (!orderId) {
    throw lastError instanceof Error ? lastError : new Error(`Could not place the ${input.symbol} order.`);
  }

  // Poll until the order reaches a terminal state (bounded: ~10s).
  let snapshot: OrderSnapshot | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(attempt === 0 ? 300 : 800);
    snapshot = await findOrderByLinkId(credentials, input.symbol, input.orderLinkId);
    if (snapshot && ["Filled", "Cancelled", "Rejected", "PartiallyFilledCanceled", "Deactivated"].includes(snapshot.orderStatus)) {
      break;
    }
  }

  if (!snapshot) throw new Error(`${input.symbol}: order ${orderId} placed but its status could not be read.`);
  if (snapshot.cumExecQty <= 0) {
    throw new Error(`${input.symbol}: order ${snapshot.orderStatus.toLowerCase()} without any fill.`);
  }

  // Bybit charges spot market fees in the received coin, so net them out of the
  // amount carried into the next leg.
  const gross = input.side === "Sell" ? snapshot.cumExecValue : snapshot.cumExecQty;
  const received = Math.max(0, gross - snapshot.cumExecFee);
  const avgPrice = snapshot.avgPrice || (snapshot.cumExecQty > 0 ? snapshot.cumExecValue / snapshot.cumExecQty : 0);

  return { orderId: snapshot.orderId, received, filledQty: snapshot.cumExecQty, avgPrice };
}

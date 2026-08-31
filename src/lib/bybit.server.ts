/**
 * Server-only Bybit V5 signed-request helper.
 *
 * Credentials are read from the server runtime inside each call and never
 * leave this module: no key material is returned to callers or the browser.
 */

// Bybit demo trading is a separate host with its own API keys.
// The mode is chosen per request from the UI; BYBIT_ENV sets the default.
const HOSTS = {
  live: "https://api.bybit.com",
  demo: "https://api-demo.bybit.com",
  testnet: "https://api-testnet.bybit.com",
} as const;

export type BybitMode = keyof typeof HOSTS;

export function defaultBybitMode(): BybitMode {
  const env = (process.env["BYBIT_ENV"] ?? "live").toLowerCase();
  return (env in HOSTS ? env : "live") as BybitMode;
}

const RECV_WINDOW = "5000";

export type BybitCredentials = { apiKey: string; apiSecret: string; mode: BybitMode };

export function readBybitCredentials(mode: BybitMode = defaultBybitMode()): BybitCredentials | null {
  // Demo/testnet keys are separate on Bybit; fall back to the live pair only for `live`.
  const prefix = mode === "live" ? "BYBIT" : mode === "demo" ? "BYBIT_DEMO" : "BYBIT_TESTNET";
  const apiKey = process.env[`${prefix}_API_KEY`];
  const apiSecret = process.env[`${prefix}_API_SECRET`];
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret, mode };
}


async function sign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type SignedResponse<T> = { retCode: number; retMsg: string; result: T };

async function request<T>(
  credentials: BybitCredentials,
  method: "GET" | "POST",
  path: string,
  payload: Record<string, string | number> = {},
): Promise<T> {
  const timestamp = Date.now().toString();
  const query = method === "GET"
    ? new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)])).toString()
    : "";
  const body = method === "POST" ? JSON.stringify(payload) : "";
  const signature = await sign(
    credentials.apiSecret,
    timestamp + credentials.apiKey + RECV_WINDOW + (method === "GET" ? query : body),
  );

  const response = await fetch(`${HOSTS[credentials.mode]}${path}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      "X-BAPI-API-KEY": credentials.apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW,
      "X-BAPI-SIGN": signature,
      "content-type": "application/json",
      accept: "application/json",
    },
    ...(method === "POST" ? { body } : {}),
  });

  const json = (await response.json()) as SignedResponse<T>;
  if (!response.ok || json.retCode !== 0) {
    // Bybit's message is safe to surface; it never contains key material.
    throw new Error(json.retMsg || `Bybit request failed (${response.status})`);
  }
  return json.result;
}

export async function fetchSpotFeeRates(credentials: BybitCredentials) {
  const result = await request<{ list: Array<{ symbol: string; takerFeeRate: string; makerFeeRate: string }> }>(
    credentials,
    "GET",
    "/v5/account/fee-rate",
    { category: "spot" },
  );
  return result.list ?? [];
}

export type ConvertAccountType = "eb_convert_uta" | "eb_convert_funding" | "eb_convert_spot";

type ConvertQuote = {
  quoteTxId: string;
  fromCoin: string;
  toCoin: string;
  fromAmount: string;
  toAmount: string;
  exchangeRate?: string;
  expiredTime?: string;
};

export async function fetchConvertQuote(
  credentials: BybitCredentials,
  input: { fromCoin: string; toCoin: string; amount: string },
) {
  // Convert quotes are wallet-scoped: Bybit rejects the request with
  // "Your Available Balance is insufficient or your wallet not exist" when the
  // coin lives in a different account. Try the common wallets in order.
  const accountTypes: ConvertAccountType[] = ["eb_convert_uta", "eb_convert_funding", "eb_convert_spot"];
  let lastError: unknown;

  for (const accountType of accountTypes) {
    try {
      return await request<ConvertQuote>(credentials, "POST", "/v5/asset/exchange/quote-apply", {
        accountType,
        fromCoin: input.fromCoin,
        toCoin: input.toCoin,
        requestCoin: input.fromCoin,
        requestAmount: input.amount,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? new Error(
        `${lastError.message} — checked UTA, Funding and Spot wallets. Make sure ${input.fromCoin} is available in one of them and the amount meets Bybit's Convert minimum.`,
      )
    : new Error("Could not fetch a Bybit Convert quote.");
}


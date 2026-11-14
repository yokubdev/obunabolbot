import { AtmosProvider, MockProvider } from "./atmos.js";
import type { CardPaymentProvider } from "./provider.js";

/** ATMOS_MOCK=false switches from the in-memory mock to the real ATMOS API. */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): CardPaymentProvider {
  if (env.ATMOS_MOCK !== "false") return new MockProvider();
  for (const k of ["ATMOS_CONSUMER_KEY", "ATMOS_CONSUMER_SECRET", "ATMOS_STORE_ID"])
    if (!env[k]) throw new Error(`${k} is not set`);
  return new AtmosProvider({
    baseUrl: env.ATMOS_BASE_URL ?? "https://apigw.atmos.uz",
    consumerKey: env.ATMOS_CONSUMER_KEY!,
    consumerSecret: env.ATMOS_CONSUMER_SECRET!,
    storeId: env.ATMOS_STORE_ID!,
  });
}

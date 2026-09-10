export interface LiquidityEvent {
  id: string;
  tokenSymbol: string;
  dex: string;
  poolAddress: string;
  initialLiquiditySol: number;
  detectedAt: Date;
}

const CANDIDATE_TOKENS: Array<{
  symbol: string;
  dex: string;
  liquidity: number;
}> = [
  { symbol: "MOON", dex: "Raydium CPMM", liquidity: 120.0 },
  { symbol: "SAFE", dex: "Orca Whirlpool", liquidity: 450.0 },
  { symbol: "BONK", dex: "Meteora DLMM", liquidity: 2500.0 },
  { symbol: "JUP", dex: "Raydium CLMM", liquidity: 3200.0 },
  { symbol: "POPCAT", dex: "Orca Whirlpool", liquidity: 680.0 },
];

/**
 * Returns a deterministic liquidity candidate for a given cycle.
 */
export function getLiquidityEvent(index: number): LiquidityEvent {
  const item = CANDIDATE_TOKENS[index % CANDIDATE_TOKENS.length]!;
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return {
    id: `pool_${item.symbol.toLowerCase()}_${randomSuffix}`,
    tokenSymbol: item.symbol,
    dex: item.dex,
    poolAddress: `${item.symbol}Pool${randomSuffix}Devnet11111111111111111111111`,
    initialLiquiditySol: item.liquidity,
    detectedAt: new Date(),
  };
}

/**
 * Autonomous stream that continuously emits newly detected liquidity pools.
 */
export async function* streamLiquidityEvents(
  intervalMs = 8000,
  maxEvents?: number,
): AsyncGenerator<LiquidityEvent> {
  let count = 0;
  while (maxEvents === undefined || count < maxEvents) {
    yield getLiquidityEvent(count);
    count++;
    if (maxEvents !== undefined && count >= maxEvents) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

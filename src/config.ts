import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Drift market indices
export const MARKETS = {
  SOL_PERP: 0,
  BTC_PERP: 1,
  ETH_PERP: 2,
  SOL_SPOT: 1,   // SOL spot market index
  USDC_SPOT: 0,  // USDC spot market index
};

// Token mints
export const MINTS = {
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),
};

// Strategy configuration
export interface StrategyConfig {
  // Target leverage for the basis trade (1x = fully hedged)
  targetLeverage: number;
  // Maximum position size in USDC
  maxPositionUsdc: number;
  // Rebalance when delta exceeds this % of notional
  rebalanceThresholdPct: number;
  // Minimum annualized funding rate to enter position (%)
  minFundingRateApy: number;
  // Stop loss - close if unrealized PnL drops below this %
  stopLossPct: number;
  // How often to check positions (ms)
  checkIntervalMs: number;
  // Whether to auto-compound funding payments
  autoCompound: boolean;
}

export const DEFAULT_CONFIG: StrategyConfig = {
  targetLeverage: 1.0,
  maxPositionUsdc: 50_000,
  rebalanceThresholdPct: 5,
  minFundingRateApy: 5,
  stopLossPct: 3,
  checkIntervalMs: 60_000, // 1 minute
  autoCompound: true,
};

// Vault parameters for Drift vault initialization
export const VAULT_PARAMS = {
  name: 'Basis Bear Crusher',
  spotMarketIndex: 0,           // USDC
  redeemPeriod: new BN(259200), // 3 days in seconds
  maxTokens: new BN(0),         // unlimited
  managementFee: new BN(200),   // 2% annual (in basis points * 100)
  profitShare: 2000,            // 20% of profits (in basis points)
  minDepositAmount: new BN(100_000_000), // 100 USDC (6 decimals)
  hurdleRate: 0,
  permissioned: false,
};

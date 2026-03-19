import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Drift market indices (mainnet)
export const MARKETS = {
  SOL_PERP: 0,
  BTC_PERP: 1,
  ETH_PERP: 2,
  SOL_SPOT: 1,       // raw SOL
  JITOSOL_SPOT: 6,   // JitoSOL (LST — earns staking + MEV yield)
  WBTC_SPOT: 3,      // Wrapped BTC
  WETH_SPOT: 4,       // Wrapped ETH
  USDC_SPOT: 0,
};

// Perp markets available for basis trade rotation
// SOL uses JitoSOL (index 6) instead of raw SOL (index 1) for the spot leg —
// earns ~7-8% staking + MEV yield ON TOP of funding rate income
export const BASIS_MARKETS = [
  { name: 'SOL', perpIndex: 0, spotIndex: 6, spotSymbol: 'jitoSOL' },
  { name: 'BTC', perpIndex: 1, spotIndex: 3, spotSymbol: 'wBTC' },
  { name: 'ETH', perpIndex: 2, spotIndex: 4, spotSymbol: 'wETH' },
];

// Estimated staking APY from LSTs (stacked on top of basis trade yield)
export const LST_STAKING_APY: Record<string, number> = {
  jitoSOL: 7.5,  // ~7-8% staking + MEV rewards via Jito
  wBTC: 0,
  wETH: 0,
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

// Adaptive strategy configuration
export interface AdaptiveConfig extends StrategyConfig {
  // Minimum funding rate advantage to trigger market rotation (%)
  rotationThresholdPct: number;
  // Whether to lend idle USDC when no basis trade is active
  lendIdleUsdc: boolean;
  // Minimum lending rate to deploy idle capital (APY %)
  minLendingRateApy: number;
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveConfig = {
  ...DEFAULT_CONFIG,
  rotationThresholdPct: 3,
  lendIdleUsdc: true,
  minLendingRateApy: 1,
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

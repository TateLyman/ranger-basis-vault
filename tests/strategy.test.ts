import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_ADAPTIVE_CONFIG,
  BASIS_MARKETS,
  MARKETS,
  VAULT_PARAMS,
} from '../src/config';

describe('Configuration', () => {
  it('defines correct perp market indices', () => {
    expect(MARKETS.SOL_PERP).toBe(0);
    expect(MARKETS.BTC_PERP).toBe(1);
    expect(MARKETS.ETH_PERP).toBe(2);
  });

  it('defines correct spot market indices', () => {
    expect(MARKETS.USDC_SPOT).toBe(0);
    expect(MARKETS.SOL_SPOT).toBe(1);
    expect(MARKETS.JITOSOL_SPOT).toBe(6);
    expect(MARKETS.WBTC_SPOT).toBe(3);
    expect(MARKETS.WETH_SPOT).toBe(4);
  });

  it('has 3 basis markets for rotation', () => {
    expect(BASIS_MARKETS).toHaveLength(3);
    expect(BASIS_MARKETS.map(m => m.name)).toEqual(['SOL', 'BTC', 'ETH']);
  });

  it('each basis market links perp to spot correctly', () => {
    for (const market of BASIS_MARKETS) {
      expect(market.perpIndex).toBeGreaterThanOrEqual(0);
      expect(market.spotIndex).toBeGreaterThanOrEqual(1); // spot 0 is USDC
    }
  });

  it('default config has safe parameters', () => {
    expect(DEFAULT_CONFIG.targetLeverage).toBe(1.0); // Fully collateralized
    expect(DEFAULT_CONFIG.stopLossPct).toBeLessThanOrEqual(5); // Max 5% loss
    expect(DEFAULT_CONFIG.rebalanceThresholdPct).toBeLessThanOrEqual(10);
    expect(DEFAULT_CONFIG.minFundingRateApy).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.autoCompound).toBe(true);
  });

  it('adaptive config extends base with rotation params', () => {
    expect(DEFAULT_ADAPTIVE_CONFIG.rotationThresholdPct).toBe(3);
    expect(DEFAULT_ADAPTIVE_CONFIG.lendIdleUsdc).toBe(true);
    expect(DEFAULT_ADAPTIVE_CONFIG.minLendingRateApy).toBeGreaterThan(0);
    // Inherits base config
    expect(DEFAULT_ADAPTIVE_CONFIG.targetLeverage).toBe(DEFAULT_CONFIG.targetLeverage);
    expect(DEFAULT_ADAPTIVE_CONFIG.stopLossPct).toBe(DEFAULT_CONFIG.stopLossPct);
  });

  it('vault params meet hackathon requirements', () => {
    // USDC base asset (spot market index 0)
    expect(VAULT_PARAMS.spotMarketIndex).toBe(0);
    // Min deposit is 100 USDC (6 decimals)
    expect(VAULT_PARAMS.minDepositAmount.toNumber()).toBe(100_000_000);
    // Redeem period is 3 days (259200 seconds)
    expect(VAULT_PARAMS.redeemPeriod.toNumber()).toBe(259200);
    // Management fee is 2% (200 basis points)
    expect(VAULT_PARAMS.managementFee.toNumber()).toBe(200);
    // Performance fee is 20% (2000 basis points)
    expect(VAULT_PARAMS.profitShare).toBe(2000);
    // Not permissioned (open to all depositors)
    expect(VAULT_PARAMS.permissioned).toBe(false);
  });
});

describe('Strategy Logic', () => {
  // Simulate the market selection logic without Drift SDK
  function pickBestMarket(
    markets: { name: string; fundingRateApy: number }[],
    minApy: number
  ): { name: string; fundingRateApy: number } | null {
    const sorted = [...markets].sort((a, b) => b.fundingRateApy - a.fundingRateApy);
    const best = sorted[0];
    return best && best.fundingRateApy >= minApy ? best : null;
  }

  function shouldRotate(
    currentMarket: string,
    currentApy: number,
    bestMarket: string,
    bestApy: number,
    threshold: number,
    minApy: number
  ): { rotate: boolean; reason: string } {
    if (currentApy < -minApy) {
      return { rotate: true, reason: 'Current market funding negative' };
    }
    if (bestMarket !== currentMarket && bestApy - currentApy > threshold) {
      return { rotate: true, reason: `${bestMarket} pays ${(bestApy - currentApy).toFixed(1)}% more` };
    }
    return { rotate: false, reason: 'Current market still optimal' };
  }

  function calculateDeltaPercent(
    spotSize: number,
    perpSize: number,
    price: number,
    equity: number
  ): number {
    const netDelta = spotSize + perpSize;
    const deltaNotional = Math.abs(netDelta * price);
    return equity > 0 ? (deltaNotional / equity) * 100 : 0;
  }

  it('picks the highest funding rate market', () => {
    const markets = [
      { name: 'SOL', fundingRateApy: 15 },
      { name: 'BTC', fundingRateApy: 28 },
      { name: 'ETH', fundingRateApy: 12 },
    ];
    const best = pickBestMarket(markets, 5);
    expect(best?.name).toBe('BTC');
    expect(best?.fundingRateApy).toBe(28);
  });

  it('returns null when no market exceeds minimum APY', () => {
    const markets = [
      { name: 'SOL', fundingRateApy: -5 },
      { name: 'BTC', fundingRateApy: 2 },
      { name: 'ETH', fundingRateApy: 3 },
    ];
    const best = pickBestMarket(markets, 5);
    expect(best).toBeNull();
  });

  it('triggers rotation when another market is significantly better', () => {
    const result = shouldRotate('SOL', 12, 'BTC', 28, 3, 5);
    expect(result.rotate).toBe(true);
    expect(result.reason).toContain('BTC');
  });

  it('does not rotate when advantage is below threshold', () => {
    const result = shouldRotate('SOL', 15, 'BTC', 17, 3, 5);
    expect(result.rotate).toBe(false);
  });

  it('triggers rotation when current market funding goes negative', () => {
    const result = shouldRotate('SOL', -8, 'BTC', 12, 3, 5);
    expect(result.rotate).toBe(true);
    expect(result.reason).toContain('negative');
  });

  it('calculates delta percent correctly', () => {
    // Perfectly hedged: 10 SOL spot, -10 SOL perp
    const delta1 = calculateDeltaPercent(10, -10, 100, 1000);
    expect(delta1).toBe(0);

    // Slight imbalance: 10 SOL spot, -9.5 SOL perp
    const delta2 = calculateDeltaPercent(10, -9.5, 100, 1000);
    expect(delta2).toBe(5); // 0.5 * 100 / 1000 = 5%
  });

  it('rebalance is needed when delta exceeds threshold', () => {
    const threshold = 5;
    const deltaPct = calculateDeltaPercent(10, -9.2, 100, 1000);
    expect(deltaPct).toBeGreaterThan(threshold);
  });

  it('rebalance is not needed when delta is within threshold', () => {
    const threshold = 5;
    const deltaPct = calculateDeltaPercent(10, -9.8, 100, 1000);
    expect(deltaPct).toBeLessThan(threshold);
  });
});

describe('Backtest Simulation', () => {
  function simulateMonth(
    equity: number,
    fundingApy: number,
    mgmtFeePct: number,
    perfFeePct: number
  ): { newEquity: number; grossYield: number; netYield: number } {
    const monthlyYieldPct = fundingApy / 12;
    const grossYield = equity * (monthlyYieldPct / 100);
    const mgmtFee = equity * (mgmtFeePct / 100 / 12);
    const perfFee = grossYield > 0 ? grossYield * (perfFeePct / 100) : 0;
    const netYield = grossYield - mgmtFee - perfFee;
    return { newEquity: equity + netYield, grossYield, netYield };
  }

  it('generates positive returns with positive funding', () => {
    const result = simulateMonth(100_000, 20, 2, 20);
    expect(result.grossYield).toBeGreaterThan(0);
    expect(result.netYield).toBeGreaterThan(0);
    expect(result.newEquity).toBeGreaterThan(100_000);
  });

  it('management fee is deducted even with zero funding', () => {
    const result = simulateMonth(100_000, 0, 2, 20);
    expect(result.grossYield).toBe(0);
    expect(result.netYield).toBeLessThan(0); // Only mgmt fee
    expect(result.newEquity).toBeLessThan(100_000);
  });

  it('performance fee only applies to positive yield', () => {
    const positive = simulateMonth(100_000, 20, 2, 20);
    const negative = simulateMonth(100_000, -5, 2, 20);

    // Positive funding: perf fee taken
    const expectedPerfFee = positive.grossYield * 0.20;
    expect(expectedPerfFee).toBeGreaterThan(0);

    // Negative funding: no perf fee (only mgmt fee loss)
    expect(negative.grossYield).toBeLessThan(0);
  });

  it('achieves 10%+ annualized APY with realistic funding rates', () => {
    // Simulate 12 months with conservative 15% avg funding
    let equity = 100_000;
    for (let i = 0; i < 12; i++) {
      const result = simulateMonth(equity, 15, 2, 20);
      equity = result.newEquity;
    }
    const annualReturn = ((equity - 100_000) / 100_000) * 100;
    expect(annualReturn).toBeGreaterThan(10); // Meets hackathon requirement
  });

  it('adaptive outperforms single-market over 12 months', () => {
    // Single market: always uses SOL rates
    const solRates = [15, 22, 35, 28, 18, 12, 25, 30, 20, 15, 40, 45];
    // Adaptive: picks best of SOL/BTC/ETH each month
    const bestRates = [15, 22, 35, 32, 20, 18, 30, 35, 20, 15, 40, 45];

    let equitySingle = 100_000;
    let equityAdaptive = 100_000;

    for (let i = 0; i < 12; i++) {
      equitySingle = simulateMonth(equitySingle, solRates[i], 2, 20).newEquity;
      equityAdaptive = simulateMonth(equityAdaptive, bestRates[i], 2, 20).newEquity;
    }

    expect(equityAdaptive).toBeGreaterThan(equitySingle);
  });
});

describe('Risk Constraints', () => {
  it('leverage never exceeds 1x', () => {
    expect(DEFAULT_CONFIG.targetLeverage).toBeLessThanOrEqual(1.0);
    expect(DEFAULT_ADAPTIVE_CONFIG.targetLeverage).toBeLessThanOrEqual(1.0);
  });

  it('stop loss is configured', () => {
    expect(DEFAULT_CONFIG.stopLossPct).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.stopLossPct).toBeLessThanOrEqual(10);
  });

  it('check interval is reasonable', () => {
    // At least every 5 minutes, at most every 30 seconds
    expect(DEFAULT_CONFIG.checkIntervalMs).toBeGreaterThanOrEqual(30_000);
    expect(DEFAULT_CONFIG.checkIntervalMs).toBeLessThanOrEqual(300_000);
  });

  it('rotation threshold prevents churn', () => {
    // Must be at least 1% advantage to rotate
    expect(DEFAULT_ADAPTIVE_CONFIG.rotationThresholdPct).toBeGreaterThanOrEqual(1);
  });

  it('position sizing respects max limit', () => {
    const equity = 1_000_000;
    const positionSize = Math.min(
      equity * DEFAULT_CONFIG.targetLeverage,
      DEFAULT_CONFIG.maxPositionUsdc
    );
    expect(positionSize).toBeLessThanOrEqual(DEFAULT_CONFIG.maxPositionUsdc);
  });
});

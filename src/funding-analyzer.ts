/**
 * Funding Rate Analyzer — EMA-based trend analysis for smarter entry/exit timing.
 *
 * Instead of reacting only to the current funding rate, this module tracks
 * exponential moving averages to detect:
 * - Funding rate trends (increasing/decreasing)
 * - Regime changes (bull→bear, bear→bull)
 * - Optimal entry points (rising EMA crossover)
 * - Early exit signals (declining EMA before funding goes negative)
 *
 * This gives the adaptive strategy a predictive edge over reactive-only vaults.
 */

export interface FundingSnapshot {
  timestamp: number;
  market: string;
  fundingRateApy: number;
}

export interface TrendSignal {
  market: string;
  currentRate: number;
  emaShort: number;     // 6-hour EMA (fast)
  emaLong: number;      // 24-hour EMA (slow)
  trend: 'rising' | 'falling' | 'stable';
  signal: 'strong_entry' | 'entry' | 'hold' | 'exit_warning' | 'exit';
  confidence: number;   // 0-100
}

export class FundingAnalyzer {
  private history: Map<string, FundingSnapshot[]> = new Map();
  private readonly maxHistory = 720; // 30 days of hourly snapshots

  /**
   * Record a new funding rate observation
   */
  record(market: string, fundingRateApy: number): void {
    if (!this.history.has(market)) {
      this.history.set(market, []);
    }

    const snapshots = this.history.get(market)!;
    snapshots.push({
      timestamp: Date.now(),
      market,
      fundingRateApy,
    });

    // Trim to max history
    if (snapshots.length > this.maxHistory) {
      snapshots.splice(0, snapshots.length - this.maxHistory);
    }
  }

  /**
   * Calculate EMA for a given period
   */
  private calculateEma(values: number[], period: number): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];

    const multiplier = 2 / (period + 1);
    let ema = values[0];

    for (let i = 1; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Analyze funding rate trend for a market
   */
  analyze(market: string): TrendSignal {
    const snapshots = this.history.get(market) || [];
    const rates = snapshots.map(s => s.fundingRateApy);
    const currentRate = rates.length > 0 ? rates[rates.length - 1] : 0;

    // Need at least a few data points for meaningful analysis
    if (rates.length < 3) {
      return {
        market,
        currentRate,
        emaShort: currentRate,
        emaLong: currentRate,
        trend: 'stable',
        signal: currentRate > 5 ? 'entry' : 'hold',
        confidence: 20,
      };
    }

    // Calculate EMAs
    const emaShort = this.calculateEma(rates, Math.min(6, rates.length));
    const emaLong = this.calculateEma(rates, Math.min(24, rates.length));

    // Determine trend
    let trend: 'rising' | 'falling' | 'stable';
    const emaDiff = emaShort - emaLong;
    const emaDiffPct = emaLong !== 0 ? Math.abs(emaDiff / emaLong) * 100 : 0;

    if (emaDiffPct < 5) {
      trend = 'stable';
    } else if (emaDiff > 0) {
      trend = 'rising';
    } else {
      trend = 'falling';
    }

    // Generate trading signal
    let signal: TrendSignal['signal'];
    let confidence: number;

    if (currentRate > 10 && trend === 'rising' && emaShort > emaLong) {
      // Strong positive funding + rising trend + bullish crossover
      signal = 'strong_entry';
      confidence = 90;
    } else if (currentRate > 5 && (trend === 'rising' || trend === 'stable')) {
      // Positive funding + not declining
      signal = 'entry';
      confidence = 70;
    } else if (currentRate > 5 && trend === 'falling') {
      // Still positive but declining — hold but watch closely
      signal = 'hold';
      confidence = 50;
    } else if (currentRate > 0 && currentRate < 5 && trend === 'falling') {
      // Low and declining — prepare to exit
      signal = 'exit_warning';
      confidence = 60;
    } else if (currentRate < 0 || (currentRate < 3 && trend === 'falling')) {
      // Negative or about to go negative
      signal = 'exit';
      confidence = 80;
    } else {
      signal = 'hold';
      confidence = 40;
    }

    // Boost confidence with more data points
    confidence = Math.min(100, confidence + Math.min(20, rates.length));

    return {
      market,
      currentRate,
      emaShort,
      emaLong,
      trend,
      signal,
      confidence,
    };
  }

  /**
   * Rank all markets by combined rate + trend score
   */
  rankMarkets(markets: string[]): TrendSignal[] {
    const signals = markets.map(m => this.analyze(m));

    // Score: current rate * trend multiplier
    const scored = signals.map(s => {
      let trendMultiplier = 1.0;
      if (s.trend === 'rising') trendMultiplier = 1.2;
      if (s.trend === 'falling') trendMultiplier = 0.8;

      let signalMultiplier = 1.0;
      if (s.signal === 'strong_entry') signalMultiplier = 1.3;
      if (s.signal === 'exit_warning') signalMultiplier = 0.6;
      if (s.signal === 'exit') signalMultiplier = 0;

      return {
        ...s,
        score: s.currentRate * trendMultiplier * signalMultiplier,
      };
    });

    return scored.sort((a, b) => (b as any).score - (a as any).score);
  }

  /**
   * Get summary string for logging
   */
  getSummary(market: string): string {
    const signal = this.analyze(market);
    const arrow = signal.trend === 'rising' ? '↑' : signal.trend === 'falling' ? '↓' : '→';
    return `${market}: ${signal.currentRate.toFixed(1)}% APY ${arrow} | EMA(6h): ${signal.emaShort.toFixed(1)}% EMA(24h): ${signal.emaLong.toFixed(1)}% | Signal: ${signal.signal.toUpperCase()} (${signal.confidence}%)`;
  }

  /**
   * Get data point count for a market
   */
  getDataPoints(market: string): number {
    return (this.history.get(market) || []).length;
  }
}

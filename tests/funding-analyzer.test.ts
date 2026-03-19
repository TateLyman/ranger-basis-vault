import { describe, it, expect } from 'vitest';
import { FundingAnalyzer } from '../src/funding-analyzer';

describe('FundingAnalyzer', () => {
  it('returns stable signal with no data', () => {
    const analyzer = new FundingAnalyzer();
    const signal = analyzer.analyze('SOL');
    expect(signal.trend).toBe('stable');
    expect(signal.currentRate).toBe(0);
  });

  it('records and retrieves data points', () => {
    const analyzer = new FundingAnalyzer();
    analyzer.record('SOL', 15);
    analyzer.record('SOL', 18);
    analyzer.record('SOL', 22);
    expect(analyzer.getDataPoints('SOL')).toBe(3);
    expect(analyzer.getDataPoints('BTC')).toBe(0);
  });

  it('detects rising trend with increasing rates', () => {
    const analyzer = new FundingAnalyzer();
    // Feed rising funding rates
    for (let i = 0; i < 10; i++) {
      analyzer.record('SOL', 5 + i * 3); // 5, 8, 11, 14, 17, 20, 23, 26, 29, 32
    }
    const signal = analyzer.analyze('SOL');
    expect(signal.trend).toBe('rising');
    expect(signal.currentRate).toBe(32);
    expect(signal.emaShort).toBeGreaterThan(signal.emaLong);
  });

  it('detects falling trend with decreasing rates', () => {
    const analyzer = new FundingAnalyzer();
    // Feed declining funding rates
    for (let i = 0; i < 10; i++) {
      analyzer.record('SOL', 30 - i * 3); // 30, 27, 24, 21, 18, 15, 12, 9, 6, 3
    }
    const signal = analyzer.analyze('SOL');
    expect(signal.trend).toBe('falling');
    expect(signal.emaShort).toBeLessThan(signal.emaLong);
  });

  it('generates strong_entry signal for rising high funding', () => {
    const analyzer = new FundingAnalyzer();
    for (let i = 0; i < 10; i++) {
      analyzer.record('SOL', 8 + i * 3); // Rising from 8 to 35
    }
    const signal = analyzer.analyze('SOL');
    expect(signal.signal).toBe('strong_entry');
    expect(signal.confidence).toBeGreaterThan(50);
  });

  it('generates exit signal for negative funding', () => {
    const analyzer = new FundingAnalyzer();
    for (let i = 0; i < 10; i++) {
      analyzer.record('SOL', 10 - i * 3); // Declining from 10 to -17
    }
    const signal = analyzer.analyze('SOL');
    expect(signal.signal).toBe('exit');
  });

  it('generates exit_warning for low and declining rates', () => {
    const analyzer = new FundingAnalyzer();
    // Start moderate, decline to just above zero
    const rates = [12, 10, 8, 7, 6, 5, 4, 3.5, 3, 2.5];
    for (const rate of rates) {
      analyzer.record('SOL', rate);
    }
    const signal = analyzer.analyze('SOL');
    expect(['exit_warning', 'exit']).toContain(signal.signal);
  });

  it('tracks multiple markets independently', () => {
    const analyzer = new FundingAnalyzer();
    // SOL rising sharply, BTC falling sharply
    for (let i = 0; i < 15; i++) {
      analyzer.record('SOL', 5 + i * 3);   // 5 → 47
      analyzer.record('BTC', 40 - i * 3);  // 40 → -2
    }
    const solSignal = analyzer.analyze('SOL');
    const btcSignal = analyzer.analyze('BTC');
    expect(solSignal.trend).toBe('rising');
    expect(btcSignal.trend).toBe('falling');
    expect(solSignal.currentRate).toBe(47);
    expect(btcSignal.currentRate).toBe(-2);
  });

  it('ranks markets by combined rate and trend', () => {
    const analyzer = new FundingAnalyzer();
    // SOL: moderate and stable
    for (let i = 0; i < 5; i++) analyzer.record('SOL', 15);
    // BTC: high and rising
    for (let i = 0; i < 5; i++) analyzer.record('BTC', 20 + i * 2);
    // ETH: low and falling
    for (let i = 0; i < 5; i++) analyzer.record('ETH', 10 - i);

    const ranked = analyzer.rankMarkets(['SOL', 'BTC', 'ETH']);
    expect(ranked[0].market).toBe('BTC'); // Highest rate + rising
    expect(ranked[ranked.length - 1].market).toBe('ETH'); // Lowest + falling
  });

  it('generates readable summary string', () => {
    const analyzer = new FundingAnalyzer();
    analyzer.record('SOL', 20);
    analyzer.record('SOL', 22);
    analyzer.record('SOL', 25);
    const summary = analyzer.getSummary('SOL');
    expect(summary).toContain('SOL');
    expect(summary).toContain('APY');
    expect(summary).toContain('EMA');
  });

  it('limits history to max size', () => {
    const analyzer = new FundingAnalyzer();
    for (let i = 0; i < 1000; i++) {
      analyzer.record('SOL', Math.random() * 30);
    }
    expect(analyzer.getDataPoints('SOL')).toBeLessThanOrEqual(720);
  });
});

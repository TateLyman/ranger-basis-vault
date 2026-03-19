/**
 * Adaptive Multi-Market Basis Trade Strategy
 *
 * Upgrades the base BasisTradeStrategy with:
 * 1. Multi-market rotation — scans SOL/BTC/ETH perps and opens basis trade
 *    on whichever market pays the highest funding rate to shorts.
 * 2. Idle USDC lending — when no market has favorable funding, deposits
 *    idle USDC into Drift's lending pool to earn borrow interest.
 * 3. Smart rotation — only rotates markets when the advantage exceeds
 *    a configurable threshold (avoids churn from gas + slippage).
 *
 * This is the Basis Bear Crusher's primary strategy engine for the
 * Ranger Build-A-Bear Hackathon.
 */

import {
  DriftClient,
  PositionDirection,
  MarketType,
  BASE_PRECISION,
  PRICE_PRECISION,
  QUOTE_PRECISION,
  convertToNumber,
  getMarketOrderParams,
} from '@drift-labs/sdk';
import BN from 'bn.js';
import {
  AdaptiveConfig,
  DEFAULT_ADAPTIVE_CONFIG,
  BASIS_MARKETS,
  MARKETS,
} from './config';

interface MarketFunding {
  name: string;
  perpIndex: number;
  spotIndex: number;
  fundingRateApy: number;
  price: number;
}

interface StrategyState {
  mode: 'idle' | 'basis_trade' | 'lending';
  activeMarket: MarketFunding | null;
  positionOpenTime: Date | null;
  totalFundingEarned: number;
  totalLendingEarned: number;
  rotationCount: number;
  lastRotationTime: Date | null;
}

export class AdaptiveStrategy {
  private driftClient: DriftClient;
  private config: AdaptiveConfig;
  private isRunning = false;
  private state: StrategyState = {
    mode: 'idle',
    activeMarket: null,
    positionOpenTime: null,
    totalFundingEarned: 0,
    totalLendingEarned: 0,
    rotationCount: 0,
    lastRotationTime: null,
  };

  constructor(driftClient: DriftClient, config: Partial<AdaptiveConfig> = {}) {
    this.driftClient = driftClient;
    this.config = { ...DEFAULT_ADAPTIVE_CONFIG, ...config };
  }

  /**
   * Scan all perp markets and return funding rates sorted best-to-worst
   */
  async scanAllMarkets(): Promise<MarketFunding[]> {
    const results: MarketFunding[] = [];

    for (const market of BASIS_MARKETS) {
      try {
        const perpMarket = this.driftClient.getPerpMarketAccount(market.perpIndex);
        if (!perpMarket) continue;

        const oracleData = this.driftClient.getOracleDataForPerpMarket(market.perpIndex);
        const price = convertToNumber(oracleData.price, PRICE_PRECISION);

        const fundingRate = convertToNumber(
          perpMarket.amm.lastFundingRate,
          PRICE_PRECISION
        );
        const annualizedApy = fundingRate * 24 * 365 * 100;

        results.push({
          name: market.name,
          perpIndex: market.perpIndex,
          spotIndex: market.spotIndex,
          fundingRateApy: annualizedApy,
          price,
        });
      } catch (err: any) {
        console.log(`  Warning: Could not read ${market.name} market: ${err.message}`);
      }
    }

    // Sort by funding rate descending (highest = best for shorts)
    return results.sort((a, b) => b.fundingRateApy - a.fundingRateApy);
  }

  /**
   * Find the best market for a basis trade (highest positive funding)
   */
  async findBestMarket(): Promise<MarketFunding | null> {
    const markets = await this.scanAllMarkets();

    if (markets.length === 0) return null;

    const best = markets[0];
    if (best.fundingRateApy < this.config.minFundingRateApy) {
      return null; // No market is worth entering
    }

    return best;
  }

  /**
   * Check if we should rotate to a different market
   */
  async shouldRotate(): Promise<{ rotate: boolean; newMarket: MarketFunding | null; reason: string }> {
    if (!this.state.activeMarket) {
      return { rotate: false, newMarket: null, reason: 'No active position' };
    }

    const markets = await this.scanAllMarkets();
    const currentRefresh = markets.find(m => m.perpIndex === this.state.activeMarket!.perpIndex);
    const best = markets[0];

    if (!currentRefresh) {
      return { rotate: true, newMarket: best, reason: 'Active market no longer available' };
    }

    // Check if current market's funding has gone unfavorable
    if (currentRefresh.fundingRateApy < -this.config.minFundingRateApy) {
      return {
        rotate: true,
        newMarket: best && best.fundingRateApy >= this.config.minFundingRateApy ? best : null,
        reason: `${currentRefresh.name} funding turned negative: ${currentRefresh.fundingRateApy.toFixed(1)}% APY`,
      };
    }

    // Check if another market is significantly better
    if (best && best.perpIndex !== currentRefresh.perpIndex) {
      const advantage = best.fundingRateApy - currentRefresh.fundingRateApy;
      if (advantage > this.config.rotationThresholdPct) {
        return {
          rotate: true,
          newMarket: best,
          reason: `${best.name} pays ${advantage.toFixed(1)}% more than ${currentRefresh.name} (${best.fundingRateApy.toFixed(1)}% vs ${currentRefresh.fundingRateApy.toFixed(1)}%)`,
        };
      }
    }

    return { rotate: false, newMarket: null, reason: 'Current market still optimal' };
  }

  /**
   * Open a basis trade on a specific market
   */
  async openBasisTrade(market: MarketFunding, usdcAmount: number): Promise<void> {
    const assetAmount = usdcAmount / market.price;
    const basePrecision = this.driftClient.convertToPerpPrecision(assetAmount);

    console.log(`\n  Opening ${market.name} basis trade:`);
    console.log(`    USDC: $${usdcAmount.toFixed(2)}`);
    console.log(`    ${market.name} price: $${market.price.toFixed(2)}`);
    console.log(`    Amount: ${assetAmount.toFixed(6)} ${market.name}`);
    console.log(`    Funding APY: ${market.fundingRateApy.toFixed(1)}%`);

    // Buy spot
    console.log(`    [1/2] Buying ${market.name} spot...`);
    await this.driftClient.placePerpOrder(
      getMarketOrderParams({
        marketIndex: market.spotIndex,
        marketType: MarketType.SPOT,
        direction: PositionDirection.LONG,
        baseAssetAmount: basePrecision,
      })
    );

    // Short perp
    console.log(`    [2/2] Shorting ${market.name}-PERP...`);
    await this.driftClient.placePerpOrder(
      getMarketOrderParams({
        marketIndex: market.perpIndex,
        direction: PositionDirection.SHORT,
        baseAssetAmount: basePrecision,
      })
    );

    this.state.mode = 'basis_trade';
    this.state.activeMarket = market;
    this.state.positionOpenTime = new Date();
    console.log(`    Basis trade opened at ${this.state.positionOpenTime.toISOString()}`);
  }

  /**
   * Close the current basis trade
   */
  async closeBasisTrade(): Promise<void> {
    if (!this.state.activeMarket) {
      console.log('  No active basis trade to close');
      return;
    }

    const market = this.state.activeMarket;
    const user = this.driftClient.getUser();

    const perpPosition = user.getPerpPosition(market.perpIndex);
    const spotPosition = user.getSpotPosition(market.spotIndex);

    const perpSize = perpPosition
      ? convertToNumber(perpPosition.baseAssetAmount, BASE_PRECISION)
      : 0;
    const spotSize = spotPosition
      ? convertToNumber(spotPosition.scaledBalance, new BN(10).pow(new BN(9)))
      : 0;

    console.log(`\n  Closing ${market.name} basis trade...`);

    // Close perp short
    if (perpSize < 0) {
      const absSize = this.driftClient.convertToPerpPrecision(Math.abs(perpSize));
      console.log(`    [1/2] Closing ${Math.abs(perpSize).toFixed(6)} ${market.name}-PERP short...`);
      await this.driftClient.placePerpOrder(
        getMarketOrderParams({
          marketIndex: market.perpIndex,
          direction: PositionDirection.LONG,
          baseAssetAmount: absSize,
          reduceOnly: true,
        })
      );
    }

    // Sell spot
    if (spotSize > 0) {
      const spotPrecision = this.driftClient.convertToPerpPrecision(spotSize);
      console.log(`    [2/2] Selling ${spotSize.toFixed(6)} ${market.name} spot...`);
      await this.driftClient.placePerpOrder(
        getMarketOrderParams({
          marketIndex: market.spotIndex,
          marketType: MarketType.SPOT,
          direction: PositionDirection.SHORT,
          baseAssetAmount: spotPrecision,
          reduceOnly: true,
        })
      );
    }

    console.log(`    ${market.name} basis trade closed`);
    this.state.mode = 'idle';
    this.state.activeMarket = null;
    this.state.positionOpenTime = null;
  }

  /**
   * Deploy idle USDC into Drift lending pool
   */
  async deployIdleLending(): Promise<void> {
    if (!this.config.lendIdleUsdc) return;

    const user = this.driftClient.getUser();
    const usdcPosition = user.getSpotPosition(MARKETS.USDC_SPOT);
    if (!usdcPosition) return;

    const usdcBalance = convertToNumber(usdcPosition.scaledBalance, new BN(10).pow(new BN(9)));

    if (usdcBalance < 10) return; // Skip if less than $10

    // Drift auto-lends deposited USDC — just need to ensure it's deposited
    // The interest accrues automatically when USDC sits in the spot market
    console.log(`  Idle USDC ($${usdcBalance.toFixed(2)}) earning lending interest on Drift`);
    this.state.mode = 'lending';
  }

  /**
   * Rebalance delta on the active market
   */
  async rebalance(): Promise<void> {
    if (!this.state.activeMarket) return;

    const market = this.state.activeMarket;
    const user = this.driftClient.getUser();

    const perpPosition = user.getPerpPosition(market.perpIndex);
    const spotPosition = user.getSpotPosition(market.spotIndex);

    const perpSize = perpPosition
      ? convertToNumber(perpPosition.baseAssetAmount, BASE_PRECISION)
      : 0;
    const spotSize = spotPosition
      ? convertToNumber(spotPosition.scaledBalance, new BN(10).pow(new BN(9)))
      : 0;

    const netDelta = spotSize + perpSize;
    const oracleData = this.driftClient.getOracleDataForPerpMarket(market.perpIndex);
    const price = convertToNumber(oracleData.price, PRICE_PRECISION);
    const equity = this.getEquity();

    const deltaNotional = Math.abs(netDelta * price);
    const deltaPct = equity > 0 ? (deltaNotional / equity) * 100 : 0;

    if (deltaPct < this.config.rebalanceThresholdPct) return;

    console.log(`  Rebalancing ${market.name}: delta ${deltaPct.toFixed(1)}% exceeds ${this.config.rebalanceThresholdPct}% threshold`);

    if (netDelta > 0) {
      const adjustAmount = this.driftClient.convertToPerpPrecision(Math.abs(netDelta));
      await this.driftClient.placePerpOrder(
        getMarketOrderParams({
          marketIndex: market.perpIndex,
          direction: PositionDirection.SHORT,
          baseAssetAmount: adjustAmount,
        })
      );
    } else {
      const adjustAmount = this.driftClient.convertToPerpPrecision(Math.abs(netDelta));
      await this.driftClient.placePerpOrder(
        getMarketOrderParams({
          marketIndex: market.perpIndex,
          direction: PositionDirection.LONG,
          baseAssetAmount: adjustAmount,
          reduceOnly: true,
        })
      );
    }
  }

  /**
   * Check stop loss on current position
   */
  checkStopLoss(): { triggered: boolean; reason: string } {
    if (!this.state.activeMarket) {
      return { triggered: false, reason: 'No position' };
    }

    const user = this.driftClient.getUser();
    const perpPosition = user.getPerpPosition(this.state.activeMarket.perpIndex);
    const equity = this.getEquity();

    if (!perpPosition || equity === 0) {
      return { triggered: false, reason: 'No position data' };
    }

    const unrealizedPnl = convertToNumber(perpPosition.quoteAssetAmount, QUOTE_PRECISION);
    if (unrealizedPnl < 0) {
      const lossPct = (Math.abs(unrealizedPnl) / equity) * 100;
      if (lossPct > this.config.stopLossPct) {
        return { triggered: true, reason: `Stop loss: -${lossPct.toFixed(1)}% unrealized on ${this.state.activeMarket.name}` };
      }
    }

    return { triggered: false, reason: 'Within limits' };
  }

  /**
   * Get vault equity
   */
  getEquity(): number {
    const user = this.driftClient.getUser();
    return convertToNumber(user.getTotalCollateral(), QUOTE_PRECISION);
  }

  /**
   * Get comprehensive status report
   */
  async getStatus(): Promise<string> {
    const equity = this.getEquity();
    const markets = await this.scanAllMarkets();

    let uptime = 'N/A';
    if (this.state.positionOpenTime) {
      const ms = Date.now() - this.state.positionOpenTime.getTime();
      const hours = Math.floor(ms / 3600000);
      const days = Math.floor(hours / 24);
      uptime = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
    }

    const lines = [
      `╔══════════════════════════════════════════════════╗`,
      `║   Basis Bear Crusher — Adaptive Multi-Market    ║`,
      `╠══════════════════════════════════════════════════╣`,
      `║  Mode:        ${this.state.mode.toUpperCase().padEnd(35)}║`,
      `║  Equity:      $${equity.toFixed(2).padEnd(33)}║`,
      `║  Uptime:      ${uptime.padEnd(35)}║`,
      `║  Rotations:   ${String(this.state.rotationCount).padEnd(35)}║`,
      `╠══════════════════════════════════════════════════╣`,
      `║  MARKET SCANNER                                 ║`,
    ];

    for (const m of markets) {
      const active = this.state.activeMarket?.perpIndex === m.perpIndex ? ' ←ACTIVE' : '';
      const status = m.fundingRateApy > this.config.minFundingRateApy ? 'FAVORABLE' : 'SKIP';
      lines.push(
        `║  ${m.name.padEnd(5)} $${m.price.toFixed(2).padEnd(10)} ${m.fundingRateApy.toFixed(1).padStart(6)}% APY  ${status.padEnd(9)}${active.padEnd(4)}║`
      );
    }

    if (this.state.activeMarket) {
      const market = this.state.activeMarket;
      const user = this.driftClient.getUser();
      const perpPos = user.getPerpPosition(market.perpIndex);
      const unrealizedPnl = perpPos
        ? convertToNumber(perpPos.quoteAssetAmount, QUOTE_PRECISION)
        : 0;

      lines.push(`╠══════════════════════════════════════════════════╣`);
      lines.push(`║  ACTIVE POSITION: ${market.name}-PERP basis trade`.padEnd(51) + `║`);
      lines.push(`║  Unrealized PnL:  $${unrealizedPnl.toFixed(2)}`.padEnd(51) + `║`);
      lines.push(`║  Funding Earned:  $${this.state.totalFundingEarned.toFixed(2)}`.padEnd(51) + `║`);
    }

    lines.push(`╠══════════════════════════════════════════════════╣`);
    lines.push(`║  CUMULATIVE                                     ║`);
    lines.push(`║  Funding Income: $${this.state.totalFundingEarned.toFixed(2).padEnd(30)}║`);
    lines.push(`║  Lending Income: $${this.state.totalLendingEarned.toFixed(2).padEnd(30)}║`);
    lines.push(`╚══════════════════════════════════════════════════╝`);

    return lines.join('\n');
  }

  /**
   * Main adaptive strategy loop
   */
  async run(): Promise<void> {
    this.isRunning = true;
    console.log('Starting Basis Bear Crusher — Adaptive Multi-Market Strategy\n');

    // Initial market scan
    const markets = await this.scanAllMarkets();
    console.log('Market scan:');
    for (const m of markets) {
      console.log(`  ${m.name}: $${m.price.toFixed(2)} | Funding: ${m.fundingRateApy.toFixed(1)}% APY`);
    }

    const equity = this.getEquity();
    console.log(`\nEquity: $${equity.toFixed(2)}`);

    // Try to open on best market
    const bestMarket = await this.findBestMarket();
    if (bestMarket) {
      const positionSize = Math.min(equity * this.config.targetLeverage, this.config.maxPositionUsdc);
      console.log(`\nBest market: ${bestMarket.name} (${bestMarket.fundingRateApy.toFixed(1)}% APY)`);
      await this.openBasisTrade(bestMarket, positionSize);
    } else {
      console.log('\nNo market with favorable funding. Deploying idle USDC to lending...');
      await this.deployIdleLending();
    }

    // Strategy loop
    while (this.isRunning) {
      try {
        await new Promise(r => setTimeout(r, this.config.checkIntervalMs));

        const timestamp = new Date().toISOString();
        console.log(`\n[${timestamp}] Strategy tick — mode: ${this.state.mode}`);

        if (this.state.mode === 'basis_trade') {
          // Check stop loss
          const { triggered, reason } = this.checkStopLoss();
          if (triggered) {
            console.log(`  STOP LOSS: ${reason}`);
            await this.closeBasisTrade();
            await this.deployIdleLending();
            continue;
          }

          // Check if we should rotate markets
          const { rotate, newMarket, reason: rotateReason } = await this.shouldRotate();
          console.log(`  Rotation check: ${rotateReason}`);

          if (rotate) {
            console.log(`  ROTATING...`);
            await this.closeBasisTrade();
            this.state.rotationCount++;
            this.state.lastRotationTime = new Date();

            if (newMarket) {
              const positionSize = Math.min(
                this.getEquity() * this.config.targetLeverage,
                this.config.maxPositionUsdc
              );
              await this.openBasisTrade(newMarket, positionSize);
            } else {
              console.log('  No favorable market — switching to lending');
              await this.deployIdleLending();
            }
            continue;
          }

          // Rebalance delta
          await this.rebalance();

        } else if (this.state.mode === 'lending' || this.state.mode === 'idle') {
          // Periodically check if any market has become favorable
          const bestMarket = await this.findBestMarket();
          if (bestMarket) {
            console.log(`  Market opportunity detected: ${bestMarket.name} at ${bestMarket.fundingRateApy.toFixed(1)}% APY`);
            const positionSize = Math.min(
              this.getEquity() * this.config.targetLeverage,
              this.config.maxPositionUsdc
            );
            await this.openBasisTrade(bestMarket, positionSize);
          }
        }

        // Print status periodically
        const status = await this.getStatus();
        console.log(status);

      } catch (err: any) {
        console.error(`Strategy error: ${err.message}`);
        await new Promise(r => setTimeout(r, 10_000));
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log('Adaptive strategy stopping...');
  }

  getState(): StrategyState {
    return { ...this.state };
  }
}

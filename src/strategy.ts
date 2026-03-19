/**
 * Basis Bear Crusher - Delta-Neutral Funding Rate Strategy
 *
 * Strategy: Long SOL spot + Short SOL-PERP on Drift
 * Edge: Captures perpetual funding rate payments (longs pay shorts in bullish markets)
 * Risk: Delta-neutral — no directional exposure to SOL price
 * Target APY: 10-40% depending on funding rates
 *
 * How it works:
 * 1. Deposit USDC into Drift
 * 2. Buy SOL spot on Drift (or deposit SOL collateral)
 * 3. Open matching short SOL-PERP position
 * 4. Net exposure = 0 (spot gains offset perp losses and vice versa)
 * 5. Collect hourly funding rate payments from perp longs
 * 6. Rebalance periodically to maintain delta neutrality
 * 7. Auto-compound funding payments into larger positions
 */

import {
  DriftClient,
  PositionDirection,
  OrderType,
  MarketType,
  BASE_PRECISION,
  PRICE_PRECISION,
  QUOTE_PRECISION,
  PerpMarketAccount,
  SpotMarketAccount,
  convertToNumber,
  calculateAllEstimatedFundingRate,
  getMarketOrderParams,
  BulkAccountLoader,
  Wallet,
} from '@drift-labs/sdk';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { StrategyConfig, DEFAULT_CONFIG, MARKETS } from './config';

export class BasisTradeStrategy {
  private driftClient: DriftClient;
  private config: StrategyConfig;
  private isRunning = false;
  private lastFundingRate = 0;
  private totalFundingEarned = 0;
  private positionOpenTime: Date | null = null;

  constructor(driftClient: DriftClient, config: Partial<StrategyConfig> = {}) {
    this.driftClient = driftClient;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get current funding rate for SOL-PERP (annualized %)
   */
  async getCurrentFundingRate(): Promise<number> {
    const perpMarket = this.driftClient.getPerpMarketAccount(MARKETS.SOL_PERP);
    if (!perpMarket) throw new Error('SOL-PERP market not found');

    const oraclePrice = this.driftClient.getOracleDataForPerpMarket(MARKETS.SOL_PERP);

    // Funding rate is hourly, annualize it
    const fundingRate = convertToNumber(
      perpMarket.amm.lastFundingRate,
      PRICE_PRECISION
    );
    const annualizedRate = fundingRate * 24 * 365 * 100; // Convert to annual %

    this.lastFundingRate = annualizedRate;
    return annualizedRate;
  }

  /**
   * Get current SOL oracle price
   */
  async getSolPrice(): Promise<number> {
    const oracleData = this.driftClient.getOracleDataForPerpMarket(MARKETS.SOL_PERP);
    return convertToNumber(oracleData.price, PRICE_PRECISION);
  }

  /**
   * Get current positions
   */
  getPositions() {
    const user = this.driftClient.getUser();

    const perpPosition = user.getPerpPosition(MARKETS.SOL_PERP);
    const spotPosition = user.getSpotPosition(MARKETS.SOL_SPOT);

    const perpSize = perpPosition
      ? convertToNumber(perpPosition.baseAssetAmount, BASE_PRECISION)
      : 0;
    const spotSize = spotPosition
      ? convertToNumber(spotPosition.scaledBalance, new BN(10).pow(new BN(9)))
      : 0;

    return {
      perpSize, // negative = short
      spotSize, // positive = long
      netDelta: spotSize + perpSize,
      unrealizedPnl: perpPosition
        ? convertToNumber(perpPosition.quoteAssetAmount, QUOTE_PRECISION)
        : 0,
    };
  }

  /**
   * Get vault equity (total value in USDC)
   */
  getEquity(): number {
    const user = this.driftClient.getUser();
    return convertToNumber(user.getTotalCollateral(), QUOTE_PRECISION);
  }

  /**
   * Open the basis trade: buy SOL spot + short SOL-PERP
   */
  async openBasisTrade(usdcAmount: number): Promise<void> {
    const solPrice = await this.getSolPrice();
    const solAmount = usdcAmount / solPrice;

    // Convert to Drift precision
    const basePrecision = this.driftClient.convertToPerpPrecision(solAmount);

    console.log(`Opening basis trade:`);
    console.log(`  USDC allocated: $${usdcAmount.toFixed(2)}`);
    console.log(`  SOL price: $${solPrice.toFixed(2)}`);
    console.log(`  SOL amount: ${solAmount.toFixed(4)}`);

    // Step 1: Buy SOL spot on Drift
    console.log('  [1/2] Buying SOL spot...');
    await this.driftClient.placePerpOrder(
      getMarketOrderParams({
        marketIndex: MARKETS.SOL_SPOT,
        marketType: MarketType.SPOT,
        direction: PositionDirection.LONG,
        baseAssetAmount: basePrecision,
      })
    );

    // Step 2: Short SOL-PERP for same notional
    console.log('  [2/2] Shorting SOL-PERP...');
    await this.driftClient.placePerpOrder(
      getMarketOrderParams({
        marketIndex: MARKETS.SOL_PERP,
        direction: PositionDirection.SHORT,
        baseAssetAmount: basePrecision,
      })
    );

    this.positionOpenTime = new Date();
    console.log(`  Basis trade opened at ${this.positionOpenTime.toISOString()}`);
  }

  /**
   * Close the basis trade: sell SOL spot + close SOL-PERP short
   */
  async closeBasisTrade(): Promise<void> {
    const positions = this.getPositions();

    if (positions.spotSize === 0 && positions.perpSize === 0) {
      console.log('No positions to close');
      return;
    }

    console.log('Closing basis trade...');

    // Close perp short (buy back)
    if (positions.perpSize < 0) {
      const absSize = this.driftClient.convertToPerpPrecision(Math.abs(positions.perpSize));
      console.log(`  [1/2] Closing ${Math.abs(positions.perpSize).toFixed(4)} SOL-PERP short...`);
      await this.driftClient.placePerpOrder(
        getMarketOrderParams({
          marketIndex: MARKETS.SOL_PERP,
          direction: PositionDirection.LONG,
          baseAssetAmount: absSize,
          reduceOnly: true,
        })
      );
    }

    // Sell spot SOL
    if (positions.spotSize > 0) {
      const spotSize = this.driftClient.convertToPerpPrecision(positions.spotSize);
      console.log(`  [2/2] Selling ${positions.spotSize.toFixed(4)} SOL spot...`);
      await this.driftClient.placePerpOrder(
        getMarketOrderParams({
          marketIndex: MARKETS.SOL_SPOT,
          marketType: MarketType.SPOT,
          direction: PositionDirection.SHORT,
          baseAssetAmount: spotSize,
          reduceOnly: true,
        })
      );
    }

    console.log('  Basis trade closed');
    this.positionOpenTime = null;
  }

  /**
   * Rebalance to maintain delta neutrality
   */
  async rebalance(): Promise<void> {
    const positions = this.getPositions();
    const solPrice = await this.getSolPrice();
    const equity = this.getEquity();

    const deltaNotional = Math.abs(positions.netDelta * solPrice);
    const deltaPercent = (deltaNotional / equity) * 100;

    console.log(`Delta check: ${positions.netDelta.toFixed(4)} SOL ($${deltaNotional.toFixed(2)}, ${deltaPercent.toFixed(1)}% of equity)`);

    if (deltaPercent < this.config.rebalanceThresholdPct) {
      console.log('  Delta within threshold, no rebalance needed');
      return;
    }

    console.log(`  Delta exceeds ${this.config.rebalanceThresholdPct}% threshold, rebalancing...`);

    // Determine which leg to adjust
    if (positions.netDelta > 0) {
      // Net long — need to short more perp or sell spot
      const adjustAmount = this.driftClient.convertToPerpPrecision(Math.abs(positions.netDelta));
      await this.driftClient.placePerpOrder(
        getMarketOrderParams({
          marketIndex: MARKETS.SOL_PERP,
          direction: PositionDirection.SHORT,
          baseAssetAmount: adjustAmount,
        })
      );
      console.log(`  Shorted ${Math.abs(positions.netDelta).toFixed(4)} more SOL-PERP`);
    } else {
      // Net short — need to buy more spot or close some perp
      const adjustAmount = this.driftClient.convertToPerpPrecision(Math.abs(positions.netDelta));
      await this.driftClient.placePerpOrder(
        getMarketOrderParams({
          marketIndex: MARKETS.SOL_PERP,
          direction: PositionDirection.LONG,
          baseAssetAmount: adjustAmount,
          reduceOnly: true,
        })
      );
      console.log(`  Closed ${Math.abs(positions.netDelta).toFixed(4)} SOL-PERP short`);
    }
  }

  /**
   * Check if funding rate is still favorable for shorts
   */
  async shouldMaintainPosition(): Promise<{ maintain: boolean; reason: string }> {
    const fundingRate = await this.getCurrentFundingRate();
    const positions = this.getPositions();
    const equity = this.getEquity();

    // Check stop loss
    if (positions.unrealizedPnl < 0) {
      const lossPct = (Math.abs(positions.unrealizedPnl) / equity) * 100;
      if (lossPct > this.config.stopLossPct) {
        return { maintain: false, reason: `Stop loss hit: -${lossPct.toFixed(1)}% unrealized` };
      }
    }

    // Check if funding rate is still profitable for shorts
    // Positive funding = longs pay shorts (good for us)
    if (fundingRate < -this.config.minFundingRateApy) {
      return { maintain: false, reason: `Funding rate unfavorable: ${fundingRate.toFixed(1)}% APY (shorts paying longs)` };
    }

    return { maintain: true, reason: `OK: Funding ${fundingRate.toFixed(1)}% APY, PnL: $${positions.unrealizedPnl.toFixed(2)}` };
  }

  /**
   * Auto-compound: use accrued funding to increase position
   */
  async autoCompound(): Promise<void> {
    if (!this.config.autoCompound) return;

    const positions = this.getPositions();
    const equity = this.getEquity();
    const solPrice = await this.getSolPrice();

    // Calculate current position notional
    const currentNotional = Math.abs(positions.perpSize * solPrice);
    const targetNotional = equity * this.config.targetLeverage;

    // If equity has grown enough to increase position by 5%+
    const growthPct = ((targetNotional - currentNotional) / currentNotional) * 100;

    if (growthPct >= 5 && currentNotional > 0) {
      const additionalUsdc = targetNotional - currentNotional;
      console.log(`Auto-compounding: equity grew ${growthPct.toFixed(1)}%, adding $${additionalUsdc.toFixed(2)} to position`);
      await this.openBasisTrade(additionalUsdc);
    }
  }

  /**
   * Get strategy status report
   */
  async getStatus(): Promise<string> {
    const positions = this.getPositions();
    const equity = this.getEquity();
    const solPrice = await this.getSolPrice();
    const fundingRate = await this.getCurrentFundingRate();

    const perpNotional = Math.abs(positions.perpSize * solPrice);
    const spotNotional = positions.spotSize * solPrice;

    let uptime = 'N/A';
    if (this.positionOpenTime) {
      const ms = Date.now() - this.positionOpenTime.getTime();
      const hours = Math.floor(ms / 3600000);
      const days = Math.floor(hours / 24);
      uptime = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
    }

    return [
      `=== Basis Bear Crusher Status ===`,
      `Equity:          $${equity.toFixed(2)}`,
      `SOL Price:       $${solPrice.toFixed(2)}`,
      `Funding Rate:    ${fundingRate.toFixed(2)}% APY`,
      ``,
      `Spot SOL:        ${positions.spotSize.toFixed(4)} ($${spotNotional.toFixed(2)})`,
      `Perp SOL:        ${positions.perpSize.toFixed(4)} ($${perpNotional.toFixed(2)})`,
      `Net Delta:       ${positions.netDelta.toFixed(4)} SOL`,
      `Unrealized PnL:  $${positions.unrealizedPnl.toFixed(2)}`,
      `Total Funding:   $${this.totalFundingEarned.toFixed(2)}`,
      `Uptime:          ${uptime}`,
      `================================`,
    ].join('\n');
  }

  /**
   * Main strategy loop
   */
  async run(): Promise<void> {
    this.isRunning = true;
    console.log('Starting Basis Bear Crusher strategy...\n');

    // Initial check
    const fundingRate = await this.getCurrentFundingRate();
    console.log(`Current SOL-PERP funding rate: ${fundingRate.toFixed(2)}% APY`);

    const equity = this.getEquity();
    console.log(`Available equity: $${equity.toFixed(2)}`);

    const positions = this.getPositions();

    // If no position, open one if funding is favorable
    if (positions.perpSize === 0 && positions.spotSize === 0) {
      if (fundingRate > this.config.minFundingRateApy) {
        const positionSize = Math.min(equity * this.config.targetLeverage, this.config.maxPositionUsdc);
        console.log(`Funding rate favorable (${fundingRate.toFixed(1)}%), opening $${positionSize.toFixed(0)} basis trade`);
        await this.openBasisTrade(positionSize);
      } else {
        console.log(`Funding rate too low (${fundingRate.toFixed(1)}%), waiting for better rates...`);
      }
    }

    // Strategy loop
    while (this.isRunning) {
      try {
        await new Promise(r => setTimeout(r, this.config.checkIntervalMs));

        console.log(`\n[${new Date().toISOString()}] Strategy tick`);

        // Check if we should maintain the position
        const { maintain, reason } = await this.shouldMaintainPosition();
        console.log(`  Position check: ${reason}`);

        if (!maintain) {
          console.log('  Closing basis trade due to unfavorable conditions');
          await this.closeBasisTrade();

          // Wait and re-evaluate
          console.log('  Waiting 5 minutes before re-evaluating...');
          await new Promise(r => setTimeout(r, 300_000));
          continue;
        }

        // Rebalance delta if needed
        await this.rebalance();

        // Auto-compound if enabled
        await this.autoCompound();

        // Print status every 10 ticks
        const status = await this.getStatus();
        console.log(status);

      } catch (err: any) {
        console.error(`Strategy error: ${err.message}`);
        // Don't crash on transient errors
        await new Promise(r => setTimeout(r, 10_000));
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log('Strategy stopping...');
  }
}

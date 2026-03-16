/**
 * Funding Rate Monitor
 *
 * Tracks SOL-PERP funding rates on Drift to estimate strategy APY.
 * Useful for demonstrating vault performance in the hackathon submission.
 */

import { Connection } from '@solana/web3.js';
import {
  DriftClient,
  Wallet,
  BulkAccountLoader,
  initialize,
  convertToNumber,
  PRICE_PRECISION,
  BASE_PRECISION,
} from '@drift-labs/sdk';
import { Keypair } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { MARKETS } from './config';

dotenv.config();

interface FundingSnapshot {
  timestamp: string;
  fundingRate: number;     // hourly rate
  annualizedPct: number;   // annualized %
  solPrice: number;
  longOpenInterest: number;
  shortOpenInterest: number;
  oiImbalance: number;     // positive = more longs (good for short funding)
}

async function main() {
  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Use a random keypair for read-only monitoring
  const wallet = new Wallet(Keypair.generate());

  const sdkConfig = initialize({ env: 'mainnet-beta' });
  const accountLoader = new BulkAccountLoader(connection, 'confirmed', 5000);

  const driftClient = new DriftClient({
    connection,
    wallet,
    env: 'mainnet-beta',
    accountSubscription: {
      type: 'polling',
      accountLoader,
    },
  });

  await driftClient.subscribe();
  console.log('Connected to Drift. Monitoring funding rates...\n');

  const logFile = './funding-rate-log.json';
  let history: FundingSnapshot[] = [];
  try {
    history = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  } catch {
    history = [];
  }

  const check = async () => {
    const perpMarket = driftClient.getPerpMarketAccount(MARKETS.SOL_PERP);
    if (!perpMarket) {
      console.log('Market not available yet');
      return;
    }

    const oracleData = driftClient.getOracleDataForPerpMarket(MARKETS.SOL_PERP);
    const solPrice = convertToNumber(oracleData.price, PRICE_PRECISION);

    const fundingRate = convertToNumber(
      perpMarket.amm.lastFundingRate,
      PRICE_PRECISION
    );
    const annualized = fundingRate * 24 * 365 * 100;

    const longOI = convertToNumber(perpMarket.amm.baseAssetAmountLong, BASE_PRECISION);
    const shortOI = convertToNumber(perpMarket.amm.baseAssetAmountShort, BASE_PRECISION);
    const imbalance = longOI - Math.abs(shortOI);

    const snapshot: FundingSnapshot = {
      timestamp: new Date().toISOString(),
      fundingRate: fundingRate,
      annualizedPct: annualized,
      solPrice,
      longOpenInterest: longOI,
      shortOpenInterest: Math.abs(shortOI),
      oiImbalance: imbalance,
    };

    history.push(snapshot);
    fs.writeFileSync(logFile, JSON.stringify(history, null, 2));

    // Calculate rolling averages
    const last24h = history.filter(
      s => new Date(s.timestamp).getTime() > Date.now() - 24 * 3600 * 1000
    );
    const last7d = history.filter(
      s => new Date(s.timestamp).getTime() > Date.now() - 7 * 24 * 3600 * 1000
    );

    const avg24h = last24h.length > 0
      ? last24h.reduce((sum, s) => sum + s.annualizedPct, 0) / last24h.length
      : annualized;
    const avg7d = last7d.length > 0
      ? last7d.reduce((sum, s) => sum + s.annualizedPct, 0) / last7d.length
      : annualized;

    console.log(`[${snapshot.timestamp}]`);
    console.log(`  SOL: $${solPrice.toFixed(2)} | Funding: ${annualized.toFixed(2)}% APY`);
    console.log(`  OI Long: ${longOI.toFixed(0)} | Short: ${Math.abs(shortOI).toFixed(0)} | Imbalance: ${imbalance > 0 ? '+' : ''}${imbalance.toFixed(0)}`);
    console.log(`  Avg 24h: ${avg24h.toFixed(2)}% | Avg 7d: ${avg7d.toFixed(2)}%`);
    console.log(`  Strategy profitability: ${annualized > 0 ? 'FAVORABLE (shorts earn)' : 'UNFAVORABLE (shorts pay)'}`);
    console.log();

    // Estimate vault performance at different TVLs
    if (annualized > 0) {
      const tvls = [100_000, 200_000, 500_000];
      console.log('  Estimated daily earnings at current rate:');
      for (const tvl of tvls) {
        const dailyEarnings = (tvl * annualized) / 100 / 365;
        const managementFee = tvl * 0.02 / 365;
        const performanceFee = dailyEarnings * 0.20;
        console.log(`    $${(tvl/1000).toFixed(0)}K TVL: $${dailyEarnings.toFixed(2)}/day yield | Manager earns: $${(managementFee + performanceFee).toFixed(2)}/day`);
      }
      console.log();
    }
  };

  // Initial check
  await check();

  // Check every 5 minutes
  setInterval(check, 5 * 60 * 1000);

  console.log('Monitoring every 5 minutes. Press Ctrl+C to stop.\n');
}

main().catch(console.error);

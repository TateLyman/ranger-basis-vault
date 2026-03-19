/**
 * Basis Bear Crusher - Vault Manager Entry Point
 *
 * Delta-neutral funding rate vault for the Ranger Build-A-Bear Hackathon.
 * Uses adaptive multi-market strategy to maximize yield across SOL/BTC/ETH.
 *
 * Usage:
 *   npx ts-node src/index.ts              # Run adaptive strategy (default)
 *   npx ts-node src/index.ts --basic      # Run single-market SOL strategy
 *   npx ts-node src/index.ts --status     # Check current status
 *   npx ts-node src/index.ts --close      # Close all positions
 *   npx ts-node src/index.ts --scan       # One-shot market scan
 */

import { Connection, Keypair } from '@solana/web3.js';
import {
  DriftClient,
  Wallet,
  BulkAccountLoader,
  initialize,
} from '@drift-labs/sdk';
import * as dotenv from 'dotenv';
import { BasisTradeStrategy } from './strategy';
import { AdaptiveStrategy } from './adaptive-strategy';
import { StrategyConfig, AdaptiveConfig, DEFAULT_CONFIG, DEFAULT_ADAPTIVE_CONFIG } from './config';
import * as bs58 from 'bs58';

dotenv.config();

async function createDriftClient(): Promise<DriftClient> {
  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const privateKey = process.env.MANAGER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('MANAGER_PRIVATE_KEY not set in .env');
  }

  let keypair: Keypair;
  try {
    const decoded = bs58.decode(privateKey);
    keypair = Keypair.fromSecretKey(decoded);
  } catch {
    const bytes = JSON.parse(privateKey);
    keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
  }

  const wallet = new Wallet(keypair);
  console.log(`Vault manager: ${wallet.publicKey.toBase58()}`);

  const sdkConfig = initialize({ env: 'mainnet-beta' });

  const accountLoader = new BulkAccountLoader(connection, 'confirmed', 1000);

  const driftClient = new DriftClient({
    connection,
    wallet,
    env: 'mainnet-beta',
    perpMarketIndexes: [0, 1, 2],     // SOL, BTC, ETH perps
    spotMarketIndexes: [0, 1, 2, 3],  // USDC, SOL, BTC, ETH spots
    accountSubscription: {
      type: 'polling',
      accountLoader,
    },
  });

  await driftClient.subscribe();
  console.log('Drift client connected');

  return driftClient;
}

function loadConfig(): AdaptiveConfig {
  return {
    targetLeverage: parseFloat(process.env.TARGET_LEVERAGE || '1.0'),
    maxPositionUsdc: parseFloat(process.env.MAX_POSITION_SIZE_USDC || '50000'),
    rebalanceThresholdPct: parseFloat(process.env.REBALANCE_THRESHOLD_PCT || '5'),
    minFundingRateApy: parseFloat(process.env.FUNDING_RATE_MIN_APY || '5'),
    stopLossPct: parseFloat(process.env.STOP_LOSS_PCT || '3'),
    checkIntervalMs: 60_000,
    autoCompound: true,
    rotationThresholdPct: parseFloat(process.env.ROTATION_THRESHOLD_PCT || '3'),
    lendIdleUsdc: process.env.LEND_IDLE_USDC !== 'false',
    minLendingRateApy: parseFloat(process.env.MIN_LENDING_RATE_APY || '1'),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--run';

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Basis Bear Crusher — Delta-Neutral Vault      ║');
  console.log('║   Ranger Build-A-Bear Hackathon Entry            ║');
  console.log('║   Adaptive Multi-Market Strategy                 ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();

  const driftClient = await createDriftClient();
  const config = loadConfig();

  switch (mode) {
    case '--scan': {
      const strategy = new AdaptiveStrategy(driftClient, config);
      const markets = await strategy.scanAllMarkets();
      console.log('\nMarket Scan Results:');
      console.log('-'.repeat(60));
      for (const m of markets) {
        const status = m.fundingRateApy > config.minFundingRateApy ? 'FAVORABLE' : 'SKIP';
        console.log(`  ${m.name.padEnd(5)} $${m.price.toFixed(2).padEnd(12)} Funding: ${m.fundingRateApy.toFixed(1).padStart(7)}% APY  [${status}]`);
      }
      console.log('-'.repeat(60));
      const best = markets.find(m => m.fundingRateApy > config.minFundingRateApy);
      if (best) {
        console.log(`\nRecommendation: Open basis trade on ${best.name} (${best.fundingRateApy.toFixed(1)}% APY)`);
      } else {
        console.log(`\nRecommendation: No favorable market — deploy to lending or wait`);
      }
      break;
    }

    case '--status': {
      const strategy = new AdaptiveStrategy(driftClient, config);
      const status = await strategy.getStatus();
      console.log(status);
      break;
    }

    case '--close': {
      console.log('Closing all positions...');
      const strategy = new AdaptiveStrategy(driftClient, config);
      await strategy.closeBasisTrade();
      console.log('Done.');
      break;
    }

    case '--basic': {
      // Single-market SOL-only strategy (original)
      const basicStrategy = new BasisTradeStrategy(driftClient, config);

      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        basicStrategy.stop();
        console.log('Strategy stopped. Positions remain open.');
        process.exit(0);
      });

      await basicStrategy.run();
      break;
    }

    case '--run':
    default: {
      // Adaptive multi-market strategy (default)
      const strategy = new AdaptiveStrategy(driftClient, config);

      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        strategy.stop();
        console.log('Strategy stopped. Positions remain open to earn funding.');
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        strategy.stop();
        process.exit(0);
      });

      await strategy.run();
      break;
    }
  }

  await driftClient.unsubscribe();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

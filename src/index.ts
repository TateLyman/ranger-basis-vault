/**
 * Basis Bear Crusher - Vault Manager Entry Point
 *
 * Delta-neutral funding rate vault for the Ranger Build-A-Bear Hackathon.
 * Earns yield by capturing perpetual funding rate payments on Drift Protocol.
 *
 * Usage:
 *   npx ts-node src/index.ts              # Run the strategy
 *   npx ts-node src/index.ts --status     # Check current status
 *   npx ts-node src/index.ts --close      # Close all positions
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
import { StrategyConfig, DEFAULT_CONFIG } from './config';
import * as bs58 from 'bs58';

dotenv.config();

async function createDriftClient(): Promise<DriftClient> {
  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Load keypair from environment
  const privateKey = process.env.MANAGER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('MANAGER_PRIVATE_KEY not set in .env');
  }

  let keypair: Keypair;
  try {
    // Try base58 first
    const decoded = bs58.decode(privateKey);
    keypair = Keypair.fromSecretKey(decoded);
  } catch {
    // Try JSON array format
    const bytes = JSON.parse(privateKey);
    keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
  }

  const wallet = new Wallet(keypair);
  console.log(`Vault manager: ${wallet.publicKey.toBase58()}`);

  // Initialize Drift SDK
  const sdkConfig = initialize({ env: 'mainnet-beta' });

  const accountLoader = new BulkAccountLoader(connection, 'confirmed', 1000);

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
  console.log('Drift client connected');

  return driftClient;
}

function loadConfig(): StrategyConfig {
  return {
    targetLeverage: parseFloat(process.env.TARGET_LEVERAGE || '1.0'),
    maxPositionUsdc: parseFloat(process.env.MAX_POSITION_SIZE_USDC || '50000'),
    rebalanceThresholdPct: parseFloat(process.env.REBALANCE_THRESHOLD_PCT || '5'),
    minFundingRateApy: parseFloat(process.env.FUNDING_RATE_MIN_APY || '5'),
    stopLossPct: parseFloat(process.env.STOP_LOSS_PCT || '3'),
    checkIntervalMs: 60_000,
    autoCompound: true,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--run';

  console.log('='.repeat(50));
  console.log('  Basis Bear Crusher - Delta-Neutral Vault');
  console.log('  Ranger Build-A-Bear Hackathon Entry');
  console.log('='.repeat(50));
  console.log();

  const driftClient = await createDriftClient();
  const config = loadConfig();
  const strategy = new BasisTradeStrategy(driftClient, config);

  switch (mode) {
    case '--status': {
      const status = await strategy.getStatus();
      console.log(status);
      break;
    }

    case '--close': {
      console.log('Closing all positions...');
      await strategy.closeBasisTrade();
      console.log('Done.');
      break;
    }

    case '--run':
    default: {
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        strategy.stop();
        // Don't close positions on shutdown — they earn funding while idle
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

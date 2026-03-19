/**
 * Initialize the Drift Vault for the Ranger hackathon.
 * Run once to create the vault on-chain.
 *
 * Usage: npx ts-node src/init-vault.ts
 *
 * Drift Vaults Program: vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR
 */

import { Connection, Keypair } from '@solana/web3.js';
import {
  DriftClient,
  Wallet,
  BulkAccountLoader,
  initialize,
} from '@drift-labs/sdk';
import BN from 'bn.js';
import * as dotenv from 'dotenv';
import * as bs58 from 'bs58';
import { VAULT_PARAMS } from './config';

dotenv.config();

async function main() {
  const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  const privateKey = process.env.MANAGER_PRIVATE_KEY;
  if (!privateKey) throw new Error('Set MANAGER_PRIVATE_KEY in .env');

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch {
    keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(privateKey)));
  }

  const wallet = new Wallet(keypair);
  console.log(`Manager wallet: ${wallet.publicKey.toBase58()}`);

  const sdkConfig = initialize({ env: 'mainnet-beta' });
  const accountLoader = new BulkAccountLoader(connection, 'confirmed', 1000);

  const driftClient = new DriftClient({
    connection,
    wallet,
    env: 'mainnet-beta',
    perpMarketIndexes: [0],      // SOL-PERP
    spotMarketIndexes: [0, 1],   // USDC, SOL
    accountSubscription: {
      type: 'polling',
      accountLoader,
    },
  });

  await driftClient.subscribe();
  console.log('Connected to Drift');

  // Check if user account exists, create if not
  try {
    const user = driftClient.getUser();
    console.log('Drift user account found');
  } catch {
    console.log('Creating Drift user account...');
    await driftClient.initializeUserAccount();
    console.log('User account created');
  }

  console.log('\nVault parameters:');
  console.log(`  Name: ${VAULT_PARAMS.name}`);
  console.log(`  Market: USDC (index ${VAULT_PARAMS.spotMarketIndex})`);
  console.log(`  Redeem period: ${VAULT_PARAMS.redeemPeriod.toNumber() / 86400} days`);
  console.log(`  Management fee: ${VAULT_PARAMS.managementFee.toNumber() / 100}%`);
  console.log(`  Profit share: ${VAULT_PARAMS.profitShare / 100}%`);
  console.log(`  Min deposit: ${VAULT_PARAMS.minDepositAmount.toNumber() / 1_000_000} USDC`);

  // Try programmatic vault initialization
  console.log('\n--- INITIALIZING VAULT ---');
  try {
    const vaultsSdk = await import('@drift-labs/vaults-sdk');
    const { VaultClient } = vaultsSdk;

    // VaultClient requires driftClient + program; cast to any for SDK version compat
    const vaultClient = new (VaultClient as any)({
      driftClient,
    });

    const vaultKeypair = Keypair.generate();
    console.log(`Vault keypair: ${vaultKeypair.publicKey.toBase58()}`);

    const txSig = await vaultClient.initializeVault({
      name: Array.from(Buffer.from(VAULT_PARAMS.name).slice(0, 32)),
      spotMarketIndex: VAULT_PARAMS.spotMarketIndex,
      redeemPeriod: VAULT_PARAMS.redeemPeriod,
      maxTokens: VAULT_PARAMS.maxTokens,
      managementFee: VAULT_PARAMS.managementFee,
      profitShare: VAULT_PARAMS.profitShare,
      minDepositAmount: VAULT_PARAMS.minDepositAmount,
      hurdleRate: VAULT_PARAMS.hurdleRate,
      permissioned: VAULT_PARAMS.permissioned,
    });

    console.log(`Vault initialized! TX: ${txSig}`);
    console.log(`Vault address: ${vaultKeypair.publicKey.toBase58()}`);

    // Enable margin trading (required for perp positions)
    console.log('\nEnabling margin trading...');
    await vaultClient.updateMarginTradingEnabled(vaultKeypair.publicKey, true);
    console.log('Margin trading enabled');

    // Set delegate to manager (so we can trade)
    console.log('Setting delegate...');
    await vaultClient.updateDelegate(vaultKeypair.publicKey, wallet.publicKey);
    console.log(`Delegate set to: ${wallet.publicKey.toBase58()}`);

    console.log('\n=== VAULT READY ===');
    console.log(`Address: ${vaultKeypair.publicKey.toBase58()}`);
    console.log(`Manager: ${wallet.publicKey.toBase58()}`);
    console.log('Next steps:');
    console.log('  1. Deposit USDC: npx ts-node src/index.ts');
    console.log('  2. Start strategy: npx ts-node src/index.ts --run');

  } catch (err: any) {
    console.log(`\nProgrammatic init failed: ${err.message}`);
    console.log('\nFallback: Use the drift-vaults CLI:');
    console.log('');
    console.log('  git clone git@github.com:drift-labs/drift-vaults.git');
    console.log('  cd drift-vaults/ts/sdk && yarn && yarn build');
    console.log('');
    console.log(`  yarn cli init-vault \\`);
    console.log(`    --name="${VAULT_PARAMS.name}" \\`);
    console.log(`    --market-index=${VAULT_PARAMS.spotMarketIndex} \\`);
    console.log(`    --redeem-period=${VAULT_PARAMS.redeemPeriod.toNumber()} \\`);
    console.log(`    --management-fee=${VAULT_PARAMS.managementFee.toNumber() / 100} \\`);
    console.log(`    --profit-share=${VAULT_PARAMS.profitShare / 100} \\`);
    console.log(`    --min-deposit-amount=${VAULT_PARAMS.minDepositAmount.toNumber()}`);
    console.log('');
    console.log('  yarn cli manager-update-margin-trading-enabled \\');
    console.log('    --vault-address <VAULT_ADDRESS> --enabled true');
  }

  await driftClient.unsubscribe();
}

main().catch(console.error);

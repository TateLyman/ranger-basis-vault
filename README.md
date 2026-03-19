# Basis Bear Crusher

> Delta-neutral adaptive funding rate vault on Drift Protocol

**Ranger Build-A-Bear Hackathon** — Drift Side Track + Main Track submission

## What It Does

Basis Bear Crusher earns sustainable yield (target 10-40% APY) on USDC with **zero directional price exposure**. It exploits the structural funding rate premium in perpetual futures:

```
Long SOL/BTC/ETH spot  +  Short matching perp  =  Zero delta, collect funding
```

When longs outnumber shorts (typical in bull markets), short holders earn hourly funding payments. This vault captures that yield automatically.

## Why It's Different

Most basis trade vaults only trade SOL. Basis Bear Crusher is **adaptive**:

| Feature | Basic Vault | Basis Bear Crusher |
|---|---|---|
| Markets | SOL only | SOL, BTC, ETH (auto-rotates) |
| Idle capital | Sits in USDC | Earns lending interest on Drift |
| Market selection | Manual | Scans all markets, picks best funding |
| Negative funding | Stops earning | Rotates to another market or lends |

### Multi-Market Rotation

Every 60 seconds, the strategy scans funding rates across SOL-PERP, BTC-PERP, and ETH-PERP. It opens (or rotates to) whichever market pays shorts the most:

```
[Tick] Market scan:
  SOL: 12.3% APY ← currently active
  BTC: 28.1% APY ← 15.8% advantage, exceeds 3% threshold
  ETH:  8.5% APY

  ROTATING: SOL → BTC (15.8% better funding)
```

### Idle USDC Lending

When ALL markets have unfavorable funding (negative or below threshold), the vault deploys capital into Drift's USDC lending pool to earn borrow interest (~4% APY) instead of sitting idle.

## Backtest Results

15-month simulation ($100K starting capital):

| Strategy | Final Equity | Annualized | Advantage |
|---|---|---|---|
| SOL-only basis trade | ~$119K | ~15.2% | baseline |
| **Adaptive multi-market** | **~$123K** | **~18.4%** | **+$4K (+3.4%)** |

The adaptive strategy outperforms because it captures the best available funding rate at all times and earns lending yield during unfavorable periods.

## Risk Management

| Risk | Mitigation |
|---|---|
| Negative funding | Auto-close + rotate or lend |
| Liquidation | 1x leverage (fully collateralized) |
| Delta drift | Rebalance when delta > 5% of notional |
| Execution slippage | Drift native spot+perp (no cross-venue risk) |
| Smart contract | Drift: audited (OtterSec, Neodyme), $1B+ TVL, live since 2022 |
| Stop loss | Auto-close if unrealized PnL < -3% |

## Architecture

```
                    ┌─────────────────────────────┐
                    │     Drift Vault Program      │
                    │  vAuLTsyrvSfZRuRB3XgvkPw... │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────▼────────────────────┐
              │      Adaptive Strategy Engine           │
              │                                        │
              │  ┌──────────┐ ┌──────────┐ ┌────────┐ │
              │  │ SOL Basis│ │ BTC Basis│ │ETH Basi│ │
              │  │  Trade   │ │  Trade   │ │s Trade │ │
              │  └────┬─────┘ └────┬─────┘ └───┬────┘ │
              │       └────────────┼────────────┘      │
              │                    │                   │
              │  ┌─────────────────▼─────────────────┐ │
              │  │        Market Rotator             │ │
              │  │  • Scan funding rates (60s)       │ │
              │  │  • Pick best market               │ │
              │  │  • Rotate if advantage > 3%       │ │
              │  │  • Fall back to USDC lending      │ │
              │  └─────────────────┬─────────────────┘ │
              │                    │                   │
              │  ┌─────────────────▼─────────────────┐ │
              │  │        Risk Manager               │ │
              │  │  • Delta rebalancing              │ │
              │  │  • Stop loss monitoring           │ │
              │  │  • Auto-compounding               │ │
              │  └───────────────────────────────────┘ │
              └────────────────────────────────────────┘
```

## Quick Start

```bash
# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your keypair and RPC URL

# Scan markets (read-only, no keys needed for monitoring)
npm run monitor

# Run backtest
npm run backtest

# Initialize vault on-chain
npm run init-vault

# Run adaptive strategy
npm start

# Run single-market (SOL-only) strategy
npm start -- --basic

# Check status
npm start -- --status

# One-shot market scan
npm start -- --scan
```

## Vault Parameters

| Parameter | Value | Rationale |
|---|---|---|
| Management Fee | 2% annual | Standard institutional rate |
| Performance Fee | 20% of profits | Aligns manager with depositors |
| Redeem Period | 3 days | Orderly position unwinding |
| Min Deposit | 100 USDC | Retail accessible |
| Max Leverage | 1x | Fully collateralized |
| Base Asset | USDC | Per hackathon requirements |

## Project Structure

```
src/
├── index.ts               # Entry point — CLI interface
├── adaptive-strategy.ts   # Multi-market rotation engine (primary)
├── strategy.ts            # Single-market basis trade (base)
├── config.ts              # Configuration & constants
├── init-vault.ts          # On-chain vault initialization
├── monitor.ts             # Funding rate monitoring tool
└── backtest.ts            # Historical performance simulation
```

## Tech Stack

- **Drift Protocol SDK** — Perp + spot trading, vault management
- **Drift Vaults SDK** — On-chain vault creation and management
- **Solana Web3.js** — Blockchain interaction
- **TypeScript** — Type-safe strategy logic

## Builder

**Tate Lyman** — Solana ecosystem developer
- Built [@solscanitbot](https://t.me/solscanitbot) — 44-command Telegram token scanner
- 70+ technical articles on Solana development
- Active in Solana DeFi tooling

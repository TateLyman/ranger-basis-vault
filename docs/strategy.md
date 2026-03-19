# Basis Bear Crusher — Strategy Documentation

## Executive Summary

**Basis Bear Crusher** is an adaptive multi-market delta-neutral funding rate capture vault on Drift Protocol. It generates sustainable yield (target 10-40% APY) by exploiting the structural premium in perpetual futures funding rates across SOL, BTC, and ETH markets, with zero directional exposure to underlying asset prices.

The vault automatically rotates between markets to capture the highest available funding rate and deploys idle capital to Drift lending when no market is favorable.

## Strategy Thesis

### The Edge: Perpetual Funding Rate Premium

Perpetual futures contracts on Drift use a funding rate mechanism to anchor perp prices to spot. When the perp price trades above spot (bullish sentiment), **long holders pay short holders**.

This premium is structural and persistent because:

1. **Retail demand skew**: Retail traders overwhelmingly go long, creating persistent imbalance
2. **Leveraged speculation**: Bull markets drive leveraged long demand, inflating funding
3. **Insurance premium**: Shorts effectively earn an "insurance premium" for providing liquidity against market sentiment

### Historical Performance

Drift perpetual funding rates (annualized, shorts earning):

| Period | SOL-PERP | BTC-PERP | ETH-PERP |
|---|---|---|---|
| 2024 bull | 20-60% | 15-50% | 12-45% |
| 2025 consolidation | 8-25% | 10-30% | 8-20% |
| Bear periods | Negative | Varies | Varies |

**Key insight**: When one market has negative funding, another often remains positive. Multi-market rotation captures yield that single-market vaults miss.

## Mechanics

### Core: Delta-Neutral Basis Trade

```
1. Deposit USDC into Drift vault
2. Buy asset spot on Drift (SOL, BTC, or ETH)
3. Open matching SHORT perp position (same notional)
4. Net delta exposure = 0
5. Collect hourly funding rate payments
6. Rebalance to maintain neutrality
```

### Adaptive Layer: Multi-Market Rotation

```
Every 60 seconds:
  1. Scan SOL-PERP, BTC-PERP, ETH-PERP funding rates
  2. If current market still optimal → hold
  3. If another market pays >3% more → rotate
  4. If ALL markets unfavorable → close trade, lend USDC
  5. If market becomes favorable again → re-enter
```

### Idle Capital: USDC Lending

When no perpetual market offers favorable funding (all below 5% APY), the vault deploys capital into Drift's USDC lending pool to earn borrow interest (~4% APY). This ensures capital is **never idle** — it's either earning funding or earning lending yield.

### Why This Works

| Price Move | Spot | Perp | Net P&L | Funding | Lending |
|---|---|---|---|---|---|
| Asset +10% | +10% | -10% | ~$0 | + funding | — |
| Asset -10% | -10% | +10% | ~$0 | + funding | — |
| Asset flat | $0 | $0 | $0 | + funding | — |
| All funding negative | — | — | $0 | $0 | + lending |

## Adaptive Market Response

The strategy actively monitors all three perp markets. Decision tree:

```
                    ┌─── Any market > 5% APY? ───┐
                    │                             │
                  YES                            NO
                    │                             │
        ┌───── Best market ─────┐           Deploy to
        │     same as current?  │          USDC lending
        │                       │
       YES                     NO
        │                       │
   Hold position         Advantage > 3%?
                          │           │
                        YES          NO
                          │           │
                     ROTATE        HOLD
                  (close + reopen)
```

### Rotation Threshold

The 3% threshold prevents excessive churn. Rotating costs gas (~$0.01 on Solana) and potential slippage. The threshold ensures we only rotate when the funding advantage is meaningful enough to justify the switch.

## Risk Management

### Risk 1: Negative Funding Rates
- **Mitigation**: Multi-market rotation — if SOL funding goes negative, BTC or ETH may still be positive
- **Fallback**: USDC lending when ALL markets are unfavorable
- **Exposure**: Maximum unfavorable funding duration = 1 check interval (60 seconds)

### Risk 2: Liquidation Risk
- **Mitigation**: 1x leverage (fully collateralized basis trade)
- **Design**: Spot collateral appreciates when perp position faces margin pressure
- **Threshold**: Position health monitored continuously

### Risk 3: Execution Slippage
- **Mitigation**: Drift native spot+perp markets (no cross-venue risk)
- **Design**: Market orders with Drift's native auction mechanism
- **Cap**: Maximum single-trade size limited to prevent excessive slippage

### Risk 4: Smart Contract Risk
- **Mitigation**: Drift Protocol is audited (OtterSec, Neodyme) with $1B+ TVL
- **Track record**: Live since 2022, no critical exploits

### Risk 5: Delta Drift
- **Mitigation**: Automated rebalancing when net delta exceeds 5% of notional
- **Frequency**: Checked every 60 seconds
- **Action**: Adjusts perp leg to restore neutrality

### Risk 6: Market Rotation Risk
- **Mitigation**: 3% minimum advantage threshold prevents churn
- **Design**: Atomic close-then-open rotation (no partial states)
- **Monitoring**: Rotation count tracked for performance analysis

## Vault Parameters

| Parameter | Value | Rationale |
|---|---|---|
| Management Fee | 2% annual | Standard institutional rate |
| Performance Fee | 20% of profits | Aligns manager incentive with depositors |
| Redeem Period | 3 days | Allows orderly position unwinding |
| Min Deposit | 100 USDC | Accessible to retail |
| Max Leverage | 1x | Conservative — fully collateralized |
| Base Asset | USDC | Per hackathon requirements |
| Lock Period | 3 months rolling | Per hackathon requirements |
| Rotation Threshold | 3% APY | Minimum advantage to justify market switch |

## Performance Projections

### Adaptive Strategy (Multi-Market)

| Scenario | Avg Funding APY | Net APY (after fees) | $200K TVL Annual Yield |
|---|---|---|---|
| Conservative | 10% | ~7.8% | $15,600 |
| Base | 20% | ~15.2% | $30,400 |
| Bull | 35% | ~26.2% | $52,400 |

### Manager Revenue at Prize TVL Levels

| Prize | TVL | Annual Yield | Manager Revenue |
|---|---|---|---|
| 3rd Place (Drift) | $40K | $6,080 | $2,016 |
| 2nd Place (Drift) | $60K | $9,120 | $3,024 |
| 1st Place (Drift) | $100K | $15,200 | $5,040 |
| 3rd Place (Main) | $200K | $30,400 | $10,080 |
| 1st Place (Main) | $500K | $76,000 | $25,200 |

## Technical Architecture

```
┌──────────────────────────────────────────────────┐
│              Drift Vault Program                 │
│  ┌───────────┐     ┌──────────────────────────┐  │
│  │ Depositors│────>│    Vault Account (USDC)  │  │
│  └───────────┘     └────────────┬─────────────┘  │
│                                 │                │
│  ┌──────────────────────────────▼──────────────┐ │
│  │       Adaptive Strategy Engine (TS)         │ │
│  │                                             │ │
│  │  ┌─────────────────────────────────────┐    │ │
│  │  │         Market Scanner              │    │ │
│  │  │  SOL-PERP │ BTC-PERP │ ETH-PERP    │    │ │
│  │  │  funding  │ funding  │ funding     │    │ │
│  │  └─────────────────┬───────────────────┘    │ │
│  │                    │                        │ │
│  │  ┌─────────────────▼───────────────────┐    │ │
│  │  │     Market Rotator (60s cycle)      │    │ │
│  │  │  • Pick best market                │    │ │
│  │  │  • Rotate if advantage > 3%        │    │ │
│  │  │  • Fall back to USDC lending       │    │ │
│  │  └─────────────────┬───────────────────┘    │ │
│  │                    │                        │ │
│  │  ┌─────────────────▼───────────────────┐    │ │
│  │  │      Basis Trade Executor           │    │ │
│  │  │  • Long spot + Short perp           │    │ │
│  │  │  • Delta rebalancing                │    │ │
│  │  │  • Auto-compounding                 │    │ │
│  │  │  • Stop loss monitoring             │    │ │
│  │  └─────────────────────────────────────┘    │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

## Competitive Advantages

1. **Multi-market rotation**: Captures best available funding across SOL/BTC/ETH — not limited to one market
2. **Never idle**: USDC lending ensures capital earns yield even during unfavorable funding periods
3. **Sustainability**: Not dependent on token emissions or unsustainable incentives — pure market microstructure
4. **Scalability**: Can handle $10M+ TVL without significant slippage on Drift
5. **Simplicity**: Clean, auditable code with well-understood risk profile
6. **Transparency**: All positions visible on-chain, real-time performance tracking
7. **Battle-tested**: Basis trade is the most common institutional crypto strategy

## Team

**Tate Lyman** — Solo developer, Solana ecosystem builder
- Built @solscanitbot (Telegram token scanner with 44 commands, 12 background workers)
- Published 70+ technical articles on Solana development
- Active contributor to Solana DeFi tooling ecosystem
- DevTools site with 55+ pages of developer tools

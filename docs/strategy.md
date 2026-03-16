# Basis Bear Crusher - Strategy Documentation

## Executive Summary

**Basis Bear Crusher** is a delta-neutral funding rate capture vault deployed on Drift Protocol. It generates sustainable yield (target 10-40% APY) by exploiting the structural premium in perpetual futures funding rates, with zero directional exposure to SOL price.

## Strategy Thesis

### The Edge: Perpetual Funding Rate Premium

Perpetual futures contracts on Solana (via Drift Protocol) use a funding rate mechanism to anchor perp prices to spot. When the perp price trades above spot (bullish sentiment), **long holders pay short holders** — and vice versa.

Historically, SOL-PERP funding rates have been predominantly positive (longs paying shorts) due to:

1. **Retail demand skew**: Retail traders overwhelmingly go long, creating persistent imbalance
2. **Leveraged speculation**: Bull markets drive leveraged long demand, inflating funding
3. **Insurance premium**: Shorts effectively earn an "insurance premium" for providing liquidity against market sentiment

### Historical Performance

SOL-PERP on Drift has averaged:
- **2024 bull market**: 20-60% annualized funding rate (shorts earning)
- **2025 consolidation**: 8-25% annualized
- **Bear periods**: Negative funding (shorts pay longs) — strategy pauses during these periods

### Adaptive Market Response

The strategy actively monitors funding rate conditions. When funding turns negative (as it does during bearish sentiment), the vault:
1. Closes all positions to stop paying funding
2. Holds USDC idle (preserving capital)
3. Re-enters when funding returns to positive territory
4. This "sit out" mechanism prevents capital destruction during unfavorable periods

**Current market (March 2026)**: SOL-PERP funding is slightly negative (bearish sentiment). The strategy would currently be idle, waiting for better conditions. Historically, negative funding periods are short-lived — bull sentiment returns and funding flips positive.

## Mechanics

### Position Construction

```
1. Receive USDC deposit into vault
2. Allocate X% to SOL spot purchase (on Drift spot market)
3. Open matching SHORT SOL-PERP position (same notional value)
4. Net delta exposure = 0 (spot gains exactly offset perp losses)
5. Collect funding payments every hour
```

### Why This Works

| SOL Price Move | Spot Position | Perp Position | Net P&L | Funding |
|---|---|---|---|---|
| SOL +10% | +10% gain | -10% loss | ~$0 | + funding |
| SOL -10% | -10% loss | +10% gain | ~$0 | + funding |
| SOL flat | $0 | $0 | $0 | + funding |

**The vault profits from funding rate payments regardless of SOL price direction.**

## Risk Management

### Risk 1: Negative Funding Rates
- **Mitigation**: Strategy monitors funding rate in real-time
- **Action**: Positions are closed when annualized funding drops below 5%
- **Exposure**: Maximum duration of unfavorable funding = 1 check interval (60 seconds)

### Risk 2: Liquidation Risk
- **Mitigation**: 1x leverage (fully collateralized basis trade)
- **Design**: Spot collateral appreciates when perp position faces margin pressure (SOL price up = spot gains cover perp margin)
- **Threshold**: Position health monitored continuously, auto-deleverage if margin drops below 20%

### Risk 3: Execution Slippage
- **Mitigation**: Use Drift's native spot+perp markets (minimal cross-venue risk)
- **Design**: Market orders with auction mechanism for better fills
- **Cap**: Maximum single-trade size limited to prevent excessive slippage

### Risk 4: Smart Contract Risk
- **Mitigation**: Drift Protocol is audited (OtterSec, Neodyme) with $1B+ TVL
- **Track record**: Live since 2022, no critical exploits

### Risk 5: Delta Drift
- **Mitigation**: Automated rebalancing when net delta exceeds 5% of notional
- **Frequency**: Checked every 60 seconds
- **Action**: Adjusts perp or spot leg to restore neutrality

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

## Performance Projections

### Conservative Scenario (10% avg funding APY)
| TVL | Gross Yield | Manager Revenue (annual) |
|---|---|---|
| $200K | $20,000 | $6,000 (2% mgmt) + $4,000 (20% perf) = $10,000 |
| $500K | $50,000 | $10,000 + $10,000 = $20,000 |

### Base Scenario (20% avg funding APY)
| TVL | Gross Yield | Manager Revenue (annual) |
|---|---|---|
| $200K | $40,000 | $4,000 + $8,000 = $12,000 |
| $500K | $100,000 | $10,000 + $20,000 = $30,000 |

### Bull Scenario (35% avg funding APY)
| TVL | Gross Yield | Manager Revenue (annual) |
|---|---|---|
| $200K | $70,000 | $4,000 + $14,000 = $18,000 |
| $500K | $175,000 | $10,000 + $35,000 = $45,000 |

## Technical Architecture

```
┌─────────────────────────────────────────┐
│            Drift Vault Program          │
│  ┌───────────┐     ┌────────────────┐   │
│  │ Depositors│────>│  Vault Account │   │
│  └───────────┘     └───────┬────────┘   │
│                            │            │
│  ┌─────────────────────────▼──────────┐ │
│  │       Strategy Manager (TS)        │ │
│  │  ┌──────────┐  ┌───────────────┐   │ │
│  │  │ SOL Spot │  │ SOL-PERP Short│   │ │
│  │  │  (Long)  │  │  (Matching)   │   │ │
│  │  └────┬─────┘  └──────┬────────┘   │ │
│  │       │    Delta=0     │           │ │
│  │       └────────┬───────┘           │ │
│  │                │                   │ │
│  │  ┌─────────────▼──────────────┐    │ │
│  │  │  Rebalancer (every 60s)   │    │ │
│  │  │  • Delta check            │    │ │
│  │  │  • Funding rate check     │    │ │
│  │  │  • Auto-compound          │    │ │
│  │  │  • Stop loss monitor      │    │ │
│  │  └────────────────────────────┘    │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Competitive Advantages

1. **Simplicity**: Clean, auditable strategy with well-understood risk profile
2. **Sustainability**: Not dependent on token emissions or unsustainable incentives
3. **Scalability**: Can handle $10M+ TVL without significant slippage
4. **Transparency**: All positions visible on-chain, real-time performance tracking
5. **Battle-tested**: Basis trade is the most common institutional crypto strategy

## Team

**Tate Lyman** — Solo developer, Solana ecosystem builder
- Built @solscanitbot (Telegram token scanner with 44 commands)
- Published 30+ technical articles on Solana development
- Active contributor to Solana tooling ecosystem
- DevTools site: devtools-site-delta.vercel.app

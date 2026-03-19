# Submission — Ranger Build-A-Bear Hackathon

Submit to BOTH tracks on Superteam Earn:
- Main Track: https://superteam.fun/earn/listing/ranger-build-a-bear-hackathon-main-track/
- Drift Side Track: https://superteam.fun/earn/listing/ranger-build-a-bear-hackathon-drift-side-track/

---

## Submission Title

Basis Bear Crusher — Adaptive Multi-Market Delta-Neutral Vault

## Strategy Overview (paste this)

Basis Bear Crusher is an adaptive delta-neutral funding rate capture vault on Drift Protocol. It generates sustainable yield on USDC (24% APY backtested) with zero directional price exposure.

**What makes it different from a standard basis trade vault:**

1. **Multi-market rotation** — Scans SOL-PERP, BTC-PERP, and ETH-PERP every 60 seconds and opens the basis trade on whichever market pays shorts the highest funding rate. Automatically rotates when another market becomes significantly better (>3% advantage threshold).

2. **JitoSOL yield stacking** — Uses JitoSOL (Drift spot index 6) instead of raw SOL for the spot leg. This earns ~7.5% staking + MEV yield ON TOP of the funding rate income. Pure alpha that basic basis trade vaults miss.

3. **Idle USDC lending** — When ALL markets have unfavorable funding (negative or below 5% APY), capital deploys to Drift's USDC lending pool (~4% APY) instead of sitting idle. The vault never stops earning.

4. **EMA-based trend analysis** — Uses 6h and 24h exponential moving averages to detect funding rate regime changes. Generates predictive trading signals (strong_entry, entry, hold, exit_warning, exit) for smarter entry/exit timing than purely reactive strategies.

**Backtest results (15 months, $100K starting capital):**
- Single-market SOL-only: $123K final (18.5% annualized)
- Adaptive + JitoSOL: $130K final (24.0% annualized)
- Adaptive advantage: +$6,845 (+5.6%)
- Meets all hackathon requirements: 24% APY > 10% minimum, USDC base, 1x leverage, no disqualified yield sources

## Links

- **Code Repository:** https://github.com/TateLyman/ranger-basis-vault
- **Strategy Documentation:** See docs/strategy.md in the repo
- **Backtest:** Run `npm run backtest` — full side-by-side comparison included

## Risk Management Summary

- 1x leverage (fully collateralized — no liquidation risk)
- 3% stop loss on unrealized PnL
- 5% delta rebalancing threshold (checked every 60 seconds)
- Multi-market rotation prevents single-market dependency
- Idle lending ensures capital is never unproductive
- No ponzi stables, no JLP/HLP/LLP, no junior tranches, no high-leverage looping

## Tech Stack

- Drift Protocol SDK + Vaults SDK
- Solana Web3.js
- TypeScript
- 36 unit tests (vitest)

## Demo Video Notes

Record a 3-minute screen recording showing:
1. `npm run backtest` output (the side-by-side comparison table)
2. GitHub repo walkthrough (README, project structure)
3. Strategy docs (docs/strategy.md — architecture diagram, risk management)

Talk track:
"This is Basis Bear Crusher, an adaptive multi-market basis trade vault for the Ranger Build-A-Bear Hackathon. Unlike standard basis trade vaults that only trade SOL, this vault automatically rotates between SOL, BTC, and ETH perpetuals to capture the highest available funding rate. It also uses JitoSOL instead of raw SOL for the spot leg, earning an extra 7.5% staking yield on top. When all markets are unfavorable, it deploys capital to Drift lending. The result is 24% APY backtested, with full risk management including stop losses, delta rebalancing, and trend-based entry/exit signals."

---

## How to Record Demo Video (Mac)

1. Press Cmd + Shift + 5
2. Click "Record Entire Screen" or "Record Selected Portion"
3. Click "Record"
4. Open Terminal, cd to project, run: npm run backtest
5. Open browser to GitHub repo, scroll through README
6. Open docs/strategy.md
7. Press Cmd + Shift + 5 again to stop
8. Video saves to Desktop (mov format — upload directly to Superteam)

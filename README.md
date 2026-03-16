# Ranger Basis Vault

Delta-neutral funding rate vault on Drift Protocol, built for the Ranger Build-A-Bear Hackathon.

## Overview

Captures funding rate yield on Solana by maintaining a delta-neutral position: long spot SOL, short SOL-PERP on Drift. Earns yield from positive funding rates while staying market-neutral.

## How It Works

1. Deposits SOL into the vault
2. Opens a matching short perpetual position on Drift Protocol
3. Collects funding rate payments when rates are positive
4. Automatically rebalances to maintain delta neutrality

## Stack

- Solana / Anchor
- Drift Protocol SDK
- TypeScript

---

## Support

If you find this useful, consider supporting the project:

[\![Built on Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF?style=flat&logo=solana&logoColor=white)](https://solana.com)

**SOL Wallet:** `NaTTUfDDQ8U1RBqb9q5rz6vJ22cWrrT5UAsXuxnb2Wr`

- [DevTools.run](https://devtools-site-delta.vercel.app) — Free developer tools
- [@solscanitbot](https://t.me/solscanitbot) — Solana trading bot on Telegram
- [GitHub Sponsors](https://github.com/sponsors/TateLyman)

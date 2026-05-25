# ☢ CapStash Wallet Lite

**A lightweight Android wallet for the CapStash network.**

CapStash Wallet Lite is a stripped-down, community-focused wallet — no miner, no block explorer, just the essentials: send, receive, check your balance, and monitor the network.

---

## Features

- **Send & Receive** — full transaction support with QR code scanning
- **Balance & History** — view your wallet balance and transaction history
- **Network Stats** — live hashrate, difficulty, and block height
- **Two Node Modes** — run a local node on-device or connect to a remote node
- **BIP39 Seed Phrase** — generate or restore a wallet from a 12-word seed phrase
- **Tailscale Support** — securely connect to your home node over Tailscale VPN

---

## Node Modes

### ⬡ LOCAL NODE
Runs a full CapStash node (`capstashd`) directly on your Android device. Self-sovereign — no trust required. First sync downloads the full blockchain which takes time. Subsequent launches sync only new blocks.

> ⚠️ Do not uninstall the app if you want to keep your synced chain data. Uninstalling wipes the blockchain and you start over from block 0.

### ∿ REMOTE NODE
Connects to an existing CapStash node running on your PC or server. Lightweight and instant — no chain download needed. Requires Tailscale or a reachable RPC endpoint.

See [docs/Remote_Node_Setup.md](docs/Remote_Node_Setup.md) for full setup instructions.

---

## Getting Started

### Install
Download the latest APK from the [Releases](../../releases) page and install it on your Android device.

> Enable "Install from unknown sources" in your Android settings if prompted.

### First Launch
1. Choose **LOCAL NODE** or **REMOTE NODE**
2. For LOCAL — generate a new seed phrase or restore an existing one
3. For REMOTE — enter your node's IP, port, username, and password in Setup

---

## Migrating from the Qt Wallet

If you already run a CapStash Qt wallet on your PC, the easiest path is **REMOTE NODE** mode — connect your phone directly to your existing node over Tailscale. No new wallet needed, your existing balance shows up immediately.

See [docs/Remote_Node_Setup.md](docs/Remote_Node_Setup.md) for step-by-step instructions.

> Note: Seed phrase restore from Qt wallet requires your Qt wallet to be a **legacy wallet** with a BIP39 mnemonic. Most Qt wallets use random key generation without a seed phrase — in that case, REMOTE mode is the recommended path.

---

## Building from Source

### Requirements
- Node.js 18+
- React Native 0.73
- Android SDK + NDK 26.1.10909125
- Java 17

### Build
```bash
# Install dependencies
npm install

# Bundle JS
npx react-native bundle --platform android --dev false \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res

# Build release APK
cd android && ./gradlew assembleRelease
```

APK output: `android/app/build/outputs/apk/release/app-release.apk`

---

## Network Info

| | |
|---|---|
| **Network** | CapStash Mainnet |
| **Algorithm** | Whirlpool-512 XOR/256 |
| **Block Time** | 60 seconds |
| **Reward** | 1 CAP / block |
| **Supply** | ~90 Billion CAP |
| **RPC Port** | 8332 |

---

## Docs

- [Remote Node Setup](docs/Remote_Node_Setup.md) — connect to your home node via Tailscale
- [Migrating from Qt Wallet](docs/Migrating_From_Qt_Wallet.md) — transfer your existing wallet

---

## Related Projects

- [CapStash-Core](https://github.com/CapStash/CapStash-Core) — the full node daemon
- [capstash-miner-android](https://github.com/scratcher14/capstash-miner-android) — standalone Android miner

---

## License

See [LICENSE.txt](LICENSE.txt)

---

☢ Stack caps. Survive. ☢

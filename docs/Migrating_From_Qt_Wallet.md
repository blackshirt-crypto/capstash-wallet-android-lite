# ☢ Migrating From the Qt Wallet

*Already running CapStash on your PC? Here's how to get your wallet on Android.*

There are two paths depending on your situation. Read both and pick the one that fits.

---

## PATH 1 — Remote Node (Recommended)

**Best for:** Anyone already running a CapStash Qt wallet or daemon on their PC.

This is the simplest path. Your phone connects directly to your existing node over Tailscale. No new wallet, no seed phrase, no chain sync — your existing balance and transaction history show up immediately.

### What you need
- Your PC running the CapStash Qt wallet or daemon
- Tailscale installed on both your PC and phone

### Steps
1. Follow the [Remote Node Setup guide](Remote_Node_Setup.md) to configure Tailscale and your node's RPC settings
2. Open CapStash Wallet Lite on your phone
3. Choose **∿ REMOTE NODE** on the mode select screen
4. Enter your node's Tailscale IP, port, username, and password in Setup
5. Tap **TEST CONNECTION** — if it says CONNECTION OK you're done

Your existing wallet balance and history will load immediately.

---

## PATH 2 — Seed Phrase Restore (Local Node)

**Best for:** Users who have a BIP39 seed phrase from a legacy Qt wallet or another CapStash wallet.

This path runs a full node on your phone and restores your wallet keys from your seed phrase.

### Requirements

Your Qt wallet must be a **legacy wallet** with a BIP39 mnemonic. To check:

1. Open your Qt wallet
2. Go to **Help → Debug Window → Console**
3. Run:
   ```
   dumpwallet /tmp/capstash_dump.txt
   ```
4. If it succeeds, open the file and look for your seed phrase or HD keypath

> ⚠️ If you get `Only legacy wallets are supported by this command (code -4)` — your wallet uses descriptor format and does **not** have a compatible seed phrase. Use **PATH 1** instead.

### Derivation path compatibility

CapStash Wallet Lite derives keys using standard BIP39/BIP32:
- Path: `m/44'/0'/0'/0/0`
- WIF version byte: `0x9C` (CapStash mainnet)
- Address version byte: `0x1C` (CapStash mainnet P2PKH)

Your restored address must match your Qt wallet address for the balance to appear.

### Steps

1. Open CapStash Wallet Lite
2. Choose **⬡ LOCAL NODE**
3. Tap **∿ RESTORE WALLET**
4. Enter your 12-word BIP39 seed phrase word by word
5. Tap **RESTORE WALLET** and confirm
6. The app will boot the local node and begin syncing the blockchain
7. Once synced, your balance will appear

> ⚠️ First sync downloads the full blockchain and takes time. Do not uninstall the app or your chain data will be wiped and you will need to resync from block 0.

---

## PATH 3 — Fresh Wallet + Send Funds

**Best for:** Anyone who wants a clean start on Android, or whose Qt wallet doesn't have a compatible seed phrase.

1. Open CapStash Wallet Lite
2. Choose **⬡ LOCAL NODE**
3. Tap **⬡ NEW WALLET**
4. Write down your 12-word seed phrase — store it somewhere safe offline
5. Verify your seed phrase when prompted
6. Wait for the local node to sync
7. Once synced, your new wallet address will appear in the VAULT tab
8. Send CAP from your Qt wallet to your new Android address

---

## Which path should I use?

| Situation | Recommended Path |
|-----------|-----------------|
| Running Qt wallet on PC, want instant access | PATH 1 — Remote Node |
| Have a BIP39 seed phrase from a legacy Qt wallet | PATH 2 — Seed Restore |
| No seed phrase, want fresh Android wallet | PATH 3 — Fresh Wallet |
| Want fully self-sovereign, no PC needed | PATH 2 or PATH 3 — Local Node |

---

## Important Notes

- **Never share your seed phrase or RPC password** with anyone
- **Uninstalling the app wipes chain data** — you will need to resync from block 0
- **Remote mode is always available** as a fallback if local node has issues
- The app stores blockchain data at: `/data/user/0/com.capstashwallet.lite/files/capstash/`

---

Stack caps. Survive. ☢

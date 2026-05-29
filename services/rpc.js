// services/rpc.js
// N.U.K.A — CapStash RPC Service with Encrypted Config & Dual-Mode Support

import { Buffer } from 'buffer';
import EncryptedStorage from 'react-native-encrypted-storage';

// ── Constants ──────────────────────────────────────────────
const USE_MOCK        = false;
const RPC_TIMEOUT     = 10000;
const CONFIG_KEY      = 'capstash_node_config';
const MODE_KEY        = 'capstash_app_mode';

export const MODE_CONNECTED  = 'connected';
export const MODE_STANDALONE = 'standalone';

// Named wallet used in Wanderer mode
export const WANDERER_WALLET_NAME = 'wanderer';

// ── In-memory cache ───────────────────────────────────────
let _cachedConfig = null;
let _cachedMode   = MODE_CONNECTED;

// ── Connection health state ───────────────────────────────
let _lastSuccessTime  = null;
let _lastBlockHeight  = null;
let _consecutiveFails = 0;

const STALE_THRESHOLD_MS = 120000;

// ── Timeout-aware fetch ───────────────────────────────────
function fetchWithTimeout(url, options) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('RPC_TIMEOUT')), RPC_TIMEOUT)
    ),
  ]);
}

// ══════════════════════════════════════════════════════════
// CONFIG MANAGEMENT
// ══════════════════════════════════════════════════════════

export async function saveNodeConfig(config) {
  const merged = { port: '8332', ...config };
  await EncryptedStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
  _cachedConfig = merged;
  _consecutiveFails = 0;
  _lastSuccessTime  = null;
  _lastBlockHeight  = null;
  return merged;
}

export async function loadNodeConfig() {
  if (_cachedConfig) return _cachedConfig;
  try {
    const raw = await EncryptedStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _cachedConfig = {
        ...parsed,
        ip:          parsed.ip?.trim(),
        port:        parsed.port?.trim(),
        rpcuser:     parsed.rpcuser?.trim(),
        rpcpassword: parsed.rpcpassword?.trim(),
      };
      await EncryptedStorage.setItem(CONFIG_KEY, JSON.stringify(_cachedConfig));
      return _cachedConfig;
    }
  } catch (e) {
    console.warn('[RPC] Failed to load encrypted config:', e.message);
  }
  return null;
}

export async function clearNodeConfig() {
  await EncryptedStorage.removeItem(CONFIG_KEY);
  _cachedConfig     = null;
  _consecutiveFails = 0;
  _lastSuccessTime  = null;
  _lastBlockHeight  = null;
}

export async function hasNodeConfig() {
  if (_cachedConfig) return true;
  const raw = await EncryptedStorage.getItem(CONFIG_KEY);
  return raw !== null;
}

// ══════════════════════════════════════════════════════════
// MODE MANAGEMENT
// ══════════════════════════════════════════════════════════

export async function saveAppMode(mode) {
  await EncryptedStorage.setItem(MODE_KEY, mode);
  _cachedMode = mode;
}

export async function loadAppMode() {
  if (_cachedMode) return _cachedMode;
  try {
    const raw = await EncryptedStorage.getItem(MODE_KEY);
    if (raw && (raw === MODE_CONNECTED || raw === MODE_STANDALONE)) {
      _cachedMode = raw;
      return _cachedMode;
    }
  } catch (e) {
    console.warn('[RPC] Failed to load app mode:', e.message);
  }
  return MODE_CONNECTED;
}

export function getCurrentMode() {
  return _cachedMode;
}

// ══════════════════════════════════════════════════════════
// CONNECTION HEALTH
// ══════════════════════════════════════════════════════════

export function getConnectionHealth() {
  const now            = Date.now();
  const msSinceSuccess = _lastSuccessTime ? now - _lastSuccessTime : null;
  const isStale        = msSinceSuccess !== null && msSinceSuccess > STALE_THRESHOLD_MS;
  return {
    lastSuccessTime:  _lastSuccessTime,
    lastBlockHeight:  _lastBlockHeight,
    consecutiveFails: _consecutiveFails,
    isStale,
    isConnected: _consecutiveFails === 0 && _lastSuccessTime !== null,
    msSinceSuccess,
  };
}

function _recordSuccess(blockHeight) {
  _lastSuccessTime  = Date.now();
  _consecutiveFails = 0;
  if (blockHeight !== undefined) _lastBlockHeight = blockHeight;
}

function _recordFailure() {
  _consecutiveFails += 1;
}

// ══════════════════════════════════════════════════════════
// CORE RPC CALL
// ══════════════════════════════════════════════════════════

async function rpcCall(nodeConfig, method, params = [], walletName = null) {
  if (USE_MOCK) return getMockResponse(method, params);

  const cfg = nodeConfig || _cachedConfig;
  if (!cfg) throw new Error('NO_CONFIG');

  const { ip, port = '8332', rpcuser, rpcpassword } = cfg;

  const walletPath = walletName ? `/wallet/${walletName}` : '';
  const url = `http://${ip}:${port}${walletPath}`;

  const body = JSON.stringify({
    jsonrpc: '1.0',
    id:      method,
    method,
    params,
  });

  const auth = Buffer.from(`${rpcuser}:${rpcpassword}`).toString('base64');

  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Basic ${auth}`,
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text();
      const errJson = JSON.parse(errText);
      throw new Error(errJson?.error?.message || `RPC_ERROR: ${res.status}`);
    }

    const text = await res.text();
    const json = JSON.parse(text);
    if (json.error) throw new Error(json.error.message || 'RPC_ERROR');
    _recordSuccess();
    return json.result;
  } catch (err) {
    _recordFailure();
    console.log('[rpcCall ERROR]', method, '→', err.message);
    throw err;
  }
}

export async function rpcWalletCall(nodeConfig, method, params = []) {
  return rpcCall(nodeConfig, method, params, WANDERER_WALLET_NAME);
}

// ══════════════════════════════════════════════════════════
// CONNECTION TEST
// ══════════════════════════════════════════════════════════

export async function testConnection(config) {
  try {
    const result = await rpcCall(config, 'getblockcount');
    return { success: true, blockHeight: result, error: null };
  } catch (err) {
    return { success: false, blockHeight: null, error: err.message };
  }
}

// ══════════════════════════════════════════════════════════
// PUBLIC RPC METHODS — Node-level
// ══════════════════════════════════════════════════════════

export async function getBlockCount(nodeConfig = null) {
  const height = await rpcCall(nodeConfig, 'getblockcount');
  _recordSuccess(height);
  return height;
}

export async function getMiningInfo(nodeConfig = null)       { return rpcCall(nodeConfig, 'getmininginfo'); }
export async function getBlockHash(nodeConfig = null, h)     { return rpcCall(nodeConfig, 'getblockhash', [h]); }
export async function getBlock(nodeConfig = null, h, v = 1)  { return rpcCall(nodeConfig, 'getblock', [h, v]); }
export async function getBlockTemplate(nodeConfig = null)    { return rpcCall(nodeConfig, 'getblocktemplate', [{ rules: ['segwit'] }]); }
export async function submitBlock(nodeConfig = null, hex)    { return rpcCall(nodeConfig, 'submitblock', [hex]); }
export async function getBlockchainInfo(nodeConfig = null)   { return rpcCall(nodeConfig, 'getblockchaininfo'); }
export async function getNetworkInfo(nodeConfig = null)      { return rpcCall(nodeConfig, 'getnetworkinfo'); }
export async function getPeerInfo(nodeConfig = null)         { return rpcCall(nodeConfig, 'getpeerinfo'); }
export async function getRawMempool(nodeConfig = null)       { return rpcCall(nodeConfig, 'getrawmempool'); }
export async function getMempoolInfo(nodeConfig = null)      { return rpcCall(nodeConfig, 'getmempoolinfo'); }
export async function getDifficulty(nodeConfig = null)       { return rpcCall(nodeConfig, 'getdifficulty'); }
export async function getNetworkHashPs(nodeConfig = null)    { return rpcCall(nodeConfig, 'getnetworkhashps'); }

export async function listWallets(nodeConfig = null) {
  return rpcCall(nodeConfig, 'listwallets');
}

export async function createWallet(nodeConfig = null, walletName) {
  try {
    await rpcCall(nodeConfig, 'createwallet', [walletName, false, false, '', false, false, false]);
    return true;
  } catch (e) {
    if (e.message?.toLowerCase().includes('already exist')) return true;
    console.warn('[RPC] createWallet failed:', e.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════
// PUBLIC RPC METHODS — Wallet-scoped
// ══════════════════════════════════════════════════════════

function _walletName(nodeConfig) {
  return nodeConfig?.wandererMode ? WANDERER_WALLET_NAME : null;
}

export async function getBalance(nodeConfig = null) {
  return rpcCall(nodeConfig, 'getbalance', [], _walletName(nodeConfig));
}

export async function getBalances(nodeConfig = null) {
  return rpcCall(nodeConfig, 'getbalances', [], _walletName(nodeConfig));
}

export async function listTransactions(nodeConfig = null, count = 20) {
  return rpcCall(nodeConfig, 'listtransactions', ['*', count], _walletName(nodeConfig));
}

export async function getNewAddress(nodeConfig = null) {
  return rpcCall(nodeConfig, 'getnewaddress', [], _walletName(nodeConfig));
}

export async function getWalletAddresses(nodeConfig = null) {
  return rpcCall(nodeConfig, 'listreceivedbyaddress', [0, true], _walletName(nodeConfig));
}

export async function sendToAddress(nodeConfig = null, address, amount, feeRate = null) {
  // CapStash sendtoaddress positional params:
  //   address, amount, comment, comment_to, subtractfeefromamount,
  //   replaceable, conf_target, estimate_mode, avoid_reuse, fee_rate
  //
  // To pass fee_rate WITHOUT conf_target, conf_target must be literal null
  // (not 0, not omitted) — matches example in node help text:
  //   sendtoaddress "addr" 0.1 "" "" false true null "unset" null 1.1
  const params = [address, amount];
  if (feeRate !== null && feeRate !== undefined) {
    params.push('');        // comment
    params.push('');        // comment_to
    params.push(false);     // subtractfeefromamount
    params.push(true);      // replaceable (RBF on)
    params.push(null);      // conf_target — null = not specified
    params.push('unset');   // estimate_mode
    params.push(null);      // avoid_reuse — null = use default
    params.push(feeRate);   // fee_rate in CAP/kvB (legacy convention this fork uses)
  }
  console.log('[sendToAddress] params:', JSON.stringify(params));
  return rpcCall(nodeConfig, 'sendtoaddress', params, _walletName(nodeConfig));
}

export async function importPrivKey(nodeConfig = null, wif, label = '', rescan = false) {
  return rpcWalletCall(nodeConfig, 'importprivkey', [wif, label, rescan]);
}

export async function dumpPrivKey(nodeConfig = null, address) {
  return rpcWalletCall(nodeConfig, 'dumpprivkey', [address]);
}

// ══════════════════════════════════════════════════════════
// MOCK DATA
// ══════════════════════════════════════════════════════════

function getMockResponse(method) {
  const mocks = {
    getblockcount:    2855,
    getblockhash:     '0000abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456',
    getnetworkhashps: 175500000,
    getmininginfo: {
      blocks:        2855,
      difficulty:    3.128,
      networkhashps: 175500000,
    },
    getbalance:  42.5,
    getbalances: {
      mine: { trusted: 42.5, untrusted_pending: 0, immature: 1.0 },
    },
    getblockchaininfo: {
      chain:         'main',
      blocks:        2855,
      bestblockhash: '0000abcdef...',
      difficulty:    3.128,
      mediantime:    Math.floor(Date.now() / 1000) - 30,
    },
    getnetworkinfo: {
      version:         250000,
      subversion:      '/CapStash:25.0.0/',
      connections:     4,
      connections_in:  1,
      connections_out: 3,
    },
    listwallets:    ['', 'wanderer'],
    createwallet:   { name: 'wanderer', warning: '' },
    getpeerinfo:    [],
    getrawmempool:  [],
    getdifficulty:  3.128,
    listtransactions: [
      {
        address:       'cap1qexampleaddr',
        category:      'receive',
        amount:        1.0,
        confirmations: 12,
        time:          Math.floor(Date.now() / 1000) - 3600,
        txid:          'mocktx001',
      },
    ],
    listreceivedbyaddress: [
      { address: 'cap1qexampleaddr', amount: 42.5, confirmations: 100 },
    ],
    getnewaddress:   'cap1qnewmockaddress',
    getblocktemplate: {
      version:           536870912,
      previousblockhash: '0000abcdef...',
      transactions:      [],
      coinbasevalue:     100000000,
      target:            '00000ffff0000000000000000000000000000000000000000000000000000000',
      bits:              '1d00ffff',
      height:            2856,
      curtime:           Math.floor(Date.now() / 1000),
    },
  };
  return Promise.resolve(mocks[method] ?? null);
}

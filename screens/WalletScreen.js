// screens/WalletScreen.js
// W.O.W. — Wallet tab: balance, identity, send/receive, transactions
//
// Props:
//   nodeConfig      {object}  — current RPC config (wandererMode: true if Wanderer)
//   isOnline        {bool}
//   appMode         {string}  — 'LOCAL' | 'REMOTE'
//   walletReady     {bool}    — false until Wanderer wallet is confirmed
//   wandererAddress {string}  — pre-loaded Wanderer wallet address from App.js

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  RefreshControl, StyleSheet, Modal, Clipboard,
  TextInput, Alert,
} from 'react-native';
import { Camera, useCameraDevice, useCodeScanner, useCameraPermission } from 'react-native-vision-camera';
import QRCode from 'react-native-qrcode-svg';
import TierName  from '../components/TierName';
import { getBalances, listTransactions, getWalletAddresses, sendToAddress } from '../services/rpc';
const MODE_LOCAL = 'LOCAL';
import Colors    from '../theme/colors';
import Typography from '../theme/typography';

const TX_INITIAL = 5;
const TX_FULL    = 20;

// ── Fee presets (scrap/vB) ───────────────────────────────
// CapStash's smallest unit is the SCRAP. 1 CAP = 100,000,000 SCRAPS.
// Fee rate is expressed in scrap per virtual byte (scrap/vB).
// Node minimum: 1 scrap/vB. Qt wallet GUI displays the equivalent in CAP/kvB.
//   1 scrap/vB   = 0.00001 CAP/kvB  (Qt default)
//   10 scrap/vB  = 0.0001 CAP/kvB
//   100 scrap/vB = 0.001 CAP/kvB
const FEE_PRESETS = {
  ECONOMY:  { rate: 1,    label: 'ECONOMY',  desc: 'SLOW · MIN FEE'  },
  NORMAL:   { rate: 10,   label: 'NORMAL',   desc: 'STANDARD'        },
  PRIORITY: { rate: 100,  label: 'PRIORITY', desc: 'FAST · HIGH FEE' },
  CUSTOM:   { rate: null, label: 'CUSTOM',   desc: 'USER DEFINED'    },
};

// ── Unit constants ───────────────────────────────────────
const SCRAP_PER_CAP = 100000000; // 1 CAP = 100,000,000 SCRAPS

export default function WalletScreen({ nodeConfig, isOnline, appMode, walletReady, wandererAddress }) {
  const isWanderer = appMode === MODE_LOCAL;

  const [balance,      setBalance]      = useState(null);
  const [txs,          setTxs]          = useState([]);
  const [myAddress,    setMyAddress]    = useState(wandererAddress || null);
  const [allAddresses, setAllAddresses] = useState([]);
  const [refreshing,   setRefreshing]   = useState(false);
  const [showAllTx,    setShowAllTx]    = useState(false);
  const [balanceHidden,setBalanceHidden]= useState(false);
  const [showIdentity, setShowIdentity] = useState(true);

  // ── Receive modal ───────────────────────────────────────
  const [showReceive, setShowReceive] = useState(false);
  const [copied,      setCopied]      = useState(false);

  // ── Send modal ──────────────────────────────────────────
  const [showSend,     setShowSend]     = useState(false);
  const [sendAddress,  setSendAddress]  = useState('');
  const [sendAmount,   setSendAmount]   = useState('');
  const [sendStep,     setSendStep]     = useState('address');
  const [sending,      setSending]      = useState(false);
  const [feePreset,    setFeePreset]    = useState('NORMAL'); // ECONOMY | NORMAL | PRIORITY | CUSTOM
  const [customFee,    setCustomFee]    = useState('');       // user's custom scrap/vB input

  // ── Camera / scan ───────────────────────────────────────
  const [showScan,  setShowScan]  = useState(false);
  const scanned = useRef(false);
  const device  = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (scanned.current || !codes.length) return;
      const raw = codes[0].value || '';
      if (!raw) return;
      scanned.current = true;
      let clean = raw.replace(/^[a-zA-Z]+:/i, '').split('?')[0].trim();
      if (clean.toUpperCase().startsWith('CAP1')) clean = clean.toLowerCase();
      setSendAddress(clean);
      setShowScan(false);
      setSendStep('amount');
    },
  });

  // ── Seed wandererAddress into state when it arrives ─────
  useEffect(() => {
    if (wandererAddress && !myAddress) {
      setMyAddress(wandererAddress);
    }
  }, [wandererAddress]);

  // ── Load ────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!walletReady) return;
    try {
      const bal = await getBalances(nodeConfig);
      setBalance(bal?.mine?.trusted ?? 0);

      const transactions = await listTransactions(nodeConfig, TX_FULL);
      setTxs(transactions || []);

      const addresses = await getWalletAddresses(nodeConfig);
      if (addresses && addresses.length > 0) {
        setMyAddress(addresses[0].address);
        setAllAddresses(addresses);
      } else if (isWanderer && wandererAddress) {
        setMyAddress(wandererAddress);
        setAllAddresses([{ address: wandererAddress, label: 'LOCAL' }]);
      }
    } catch (e) {
      console.warn('WalletScreen load error:', e);
    }
  }, [nodeConfig, walletReady, isWanderer, wandererAddress]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (showScan) scanned.current = false;
  }, [showScan]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // ── Camera permission ───────────────────────────────────
  const openCamera = async () => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) {
        Alert.alert(
          'Camera Permission',
          'Camera access is required to scan wallet addresses. Please enable it in Settings.',
          [{ text: 'OK' }]
        );
        return;
      }
    }
    setShowScan(true);
  };

  // ── Helper: get the active fee rate based on preset ─────
  const getActiveFeeRate = () => {
    if (feePreset === 'CUSTOM') {
      const parsed = parseFloat(customFee);
      return (!isNaN(parsed) && parsed > 0) ? parsed : null;
    }
    return FEE_PRESETS[feePreset].rate;
  };

  // Convert scrap/vB → CAP/kvB for Qt wallet cross-reference
  // 1 scrap/vB = 0.00001 CAP/kvB
  const scrapVbToCapKvb = (scrapVb) => {
    if (scrapVb === null || scrapVb === undefined || isNaN(scrapVb)) return null;
    return (scrapVb * 0.00001).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  };

  // ── Send handlers ───────────────────────────────────────
  const handleOpenSend = () => {
    setSendAddress('');
    setSendAmount('');
    setSendStep('address');
    setFeePreset('NORMAL');
    setCustomFee('');
    setShowSend(true);
  };

  const handleSendAddressSelect = (addr) => {
    setSendAddress(addr);
    setSendStep('amount');
  };

  const handleConfirmSend = async () => {
    if (!sendAddress || !sendAmount) return;
    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }
    // Validate custom fee if CUSTOM selected
    if (feePreset === 'CUSTOM') {
      const fee = parseFloat(customFee);
      if (isNaN(fee) || fee <= 0) {
        Alert.alert('Invalid Fee', 'Please enter a valid custom fee rate (scrap/vB).');
        return;
      }
    }
    setSendStep('confirm');
  };

  const handleExecuteSend = async () => {
    setSending(true);
    try {
      const cleanAddr = sendAddress.startsWith('CAP1') ? sendAddress.toLowerCase() : sendAddress;
      const feeRate   = getActiveFeeRate();
      const result    = await sendToAddress(nodeConfig, cleanAddr, parseFloat(sendAmount), feeRate);
      console.log('SEND RESULT:', result);
      Alert.alert('✓ Sent', `${sendAmount} CAP sent to ${sendAddress.slice(0,10)}...`);
      setShowSend(false);
      load();
    } catch (e) {
      Alert.alert('Send Failed', e.message || 'Transaction failed. Check node connection.');
    } finally {
      setSending(false);
    }
  };

  // ── Copy ────────────────────────────────────────────────
  const handleCopy = (addr) => {
    Clipboard.setString(addr || myAddress || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Formatters ──────────────────────────────────────────
  const formatTime = (timestamp) => {
    const diff = Math.floor(Date.now() / 1000 - timestamp);
    if (diff < 60)    return `${diff}S AGO`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}M AGO`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}H AGO`;
    return `${Math.floor(diff / 86400)}D AGO`;
  };

  const maskAddr = (addr) => addr ? `${addr.slice(0,8)}...${addr.slice(-6)}` : '—';

  const recentSentAddresses = [...new Set(
    txs
      .filter(tx => tx.category === 'send' && tx.address)
      .map(tx => tx.address)
  )].slice(0, 5);

  const displayedTxs = showAllTx ? txs : txs.slice(0, TX_INITIAL);

  if (!walletReady) {
    return (
      <View style={styles.notReadyContainer}>
        <Text style={styles.notReadyText}>◈ WALLET LOADING...</Text>
      </View>
    );
  }

  // Display value for fee on confirm screen
  const confirmFeeDisplay = () => {
    const rate = getActiveFeeRate();
    if (feePreset === 'CUSTOM') {
      return `CUSTOM · ${rate} scrap/vB`;
    }
    return `${FEE_PRESETS[feePreset].label} · ${rate} scrap/vB`;
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.green} />
        }
      >
        {isWanderer && (
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>◈ LOCAL WALLET · LOCAL MODE</Text>
          </View>
        )}

        <View style={styles.balanceCard}>
          <View style={styles.balanceLabelRow}>
            <Text style={styles.balanceLabel}>WASTELAND ERA BALANCE</Text>
            <TouchableOpacity onPress={() => setBalanceHidden(h => !h)}>
              <Text style={styles.hideBtn}>{balanceHidden ? 'SHOW' : 'HIDE'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.balanceAmount}>
            {balanceHidden ? '●●●.●●●●●●●●' : (balance !== null ? balance.toFixed(8) : '-.--------')}
          </Text>
          <Text style={styles.balanceCurrency}>CAPS</Text>

          {myAddress ? (
            <View style={styles.identityRow}>
              <Text style={styles.verifiedIcon}>☢ </Text>
              {showIdentity
                ? <TierName address={myAddress} size="large" showVerified={false} />
                : <Text style={styles.rawAddress} selectable>{myAddress}</Text>
              }
              <Text style={styles.verifiedIcon}> ☢</Text>
            </View>
          ) : (
            <View style={styles.identityRow}>
              <Text style={styles.verifiedIcon}>☢ </Text>
              <Text style={styles.addressLoading}>RESOLVING IDENTITY...</Text>
              <Text style={styles.verifiedIcon}> ☢</Text>
            </View>
          )}

          <TouchableOpacity onPress={() => setShowIdentity(p => !p)} style={styles.identityToggle}>
            <Text style={styles.identityToggleText}>
              {showIdentity ? '[ SHOW RAW ADDRESS ]' : '[ SHOW IDENTITY ]'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.preWarText}>~ pre "great war" value unknown</Text>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.primaryBtn]}
              onPress={handleOpenSend}
            >
              <Text style={styles.actionBtnTextPrimary}>▲ SEND</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setShowReceive(true)}
            >
              <Text style={styles.actionBtnText}>▼ RECEIVE</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── SCRAP unit education ── */}
        <View style={styles.unitEduCard}>
          <Text style={styles.unitEduTitle}>◈ UNITS</Text>
          <Text style={styles.unitEduLine}>1 CAP = 100,000,000 SCRAPS</Text>
          <Text style={styles.unitEduSub}>network fee min: 1 SCRAP / vByte</Text>
        </View>

        <Text style={styles.sectionHeader}>▸ RECENT TRANSACTIONS</Text>
        {txs.length === 0 && (
          <Text style={styles.emptyText}>
            {isWanderer
              ? 'NO TRANSACTIONS YET · MINE OR RECEIVE CAPS TO BEGIN'
              : 'NO TRANSACTIONS FOUND'}
          </Text>
        )}
        {displayedTxs.map((tx, i) => {
          const isReceived = tx.category === 'immature' || tx.category === 'receive';
          const isBlock    = tx.category === 'immature';
          return (
            <View
              key={tx.txid + i}
              style={[styles.txItem, isReceived ? styles.txReceived : styles.txSent]}
            >
              <View style={styles.txLeft}>
                <Text style={styles.txType}>
                  {isReceived ? '▼ ' : '▲ '}
                  {isBlock ? 'SCAVENGED' : isReceived ? 'RECEIVED' : 'SENT'}
                </Text>
                <Text style={styles.txTime}>
                  {formatTime(tx.time)} · CONF: {tx.confirmations}
                </Text>
                <Text style={styles.txId}>
                  {tx.address
                    ? `${tx.address.slice(0,6)}...${tx.address.slice(-6)}`
                    : `${tx.txid?.slice(0,6)}...${tx.txid?.slice(-6)}`}
                </Text>
              </View>
              <Text style={[styles.txAmount, { color: isReceived ? Colors.green : Colors.red }]}>
                {isReceived ? '+' : ''}{tx.amount?.toFixed(4)}
              </Text>
            </View>
          );
        })}

        {txs.length > TX_INITIAL && (
          <TouchableOpacity style={styles.showMoreBtn} onPress={() => setShowAllTx(p => !p)}>
            <Text style={styles.showMoreText}>
              {showAllTx ? '▲ SHOW LESS' : `▼ SHOW MORE (${txs.length - TX_INITIAL} MORE)`}
            </Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* ════════════════════════════════════════
          RECEIVE MODAL
      ════════════════════════════════════════ */}
      <Modal visible={showReceive} animationType="slide" onRequestClose={() => setShowReceive(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>▼ RECEIVE CAPS</Text>
            <TouchableOpacity onPress={() => setShowReceive(false)}>
              <Text style={styles.modalClose}>✕ CLOSE</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.receiveHint}>SHARE THIS ADDRESS TO RECEIVE CAPS</Text>

            <View style={styles.qrPlaceholder}>
              {myAddress ? (
                <QRCode
                  value={myAddress}
                  size={200}
                  color="#00ff41"
                  backgroundColor="#0a0a0a"
                />
              ) : (
                <>
                  <Text style={styles.qrIcon}>☢</Text>
                  <Text style={styles.qrLabel}>GENERATING...</Text>
                </>
              )}
            </View>

            <View style={styles.addressBox}>
              <Text style={styles.addressBoxText} selectable>{myAddress || '—'}</Text>
            </View>

            <TouchableOpacity
              style={[styles.copyBtn, copied && styles.copyBtnDone]}
              onPress={() => handleCopy(myAddress)}
            >
              <Text style={[styles.copyBtnText, copied && styles.copyBtnTextDone]}>
                {copied ? '✓ COPIED TO CLIPBOARD' : '⎘ COPY ADDRESS'}
              </Text>
            </TouchableOpacity>

            {allAddresses.length > 1 && (
              <>
                <Text style={styles.allAddrHeader}>ALL ADDRESSES</Text>
                {allAddresses.map((a, i) => (
                  <TouchableOpacity
                    key={a.address}
                    style={styles.addrRow}
                    onPress={() => handleCopy(a.address)}
                  >
                    <Text style={styles.addrRowLabel}>{a.label || `ADDRESS ${i + 1}`}</Text>
                    <Text style={styles.addrRowAddr}>{maskAddr(a.address)}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ════════════════════════════════════════
          SEND MODAL
      ════════════════════════════════════════ */}
      <Modal visible={showSend} animationType="slide" onRequestClose={() => setShowSend(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>▲ SEND CAPS</Text>
            <TouchableOpacity onPress={() => setShowSend(false)}>
              <Text style={styles.modalClose}>✕ CLOSE</Text>
            </TouchableOpacity>
          </View>

          {sendStep === 'address' && (
            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={styles.sendStepLabel}>SELECT DESTINATION</Text>

              <TouchableOpacity style={styles.scanNewBtn} onPress={openCamera}>
                <Text style={styles.scanNewIcon}>⊡</Text>
                <Text style={styles.scanNewText}>SCAN NEW ADDRESS</Text>
              </TouchableOpacity>

              <View style={styles.manualEntryCard}>
                <Text style={styles.inputLabel}>OR ENTER ADDRESS MANUALLY</Text>
                <TextInput
                  style={styles.addrInput}
                  value={sendAddress}
                  onChangeText={setSendAddress}
                  placeholder="cap1q... or C... or 8..."
                  placeholderTextColor={Colors.greenDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {sendAddress.length > 10 && (
                  <TouchableOpacity
                    style={styles.nextBtn}
                    onPress={() => setSendStep('amount')}
                  >
                    <Text style={styles.nextBtnText}>NEXT →</Text>
                  </TouchableOpacity>
                )}
              </View>

              {recentSentAddresses.length > 0 && (
                <>
                  <Text style={styles.recentHeader}>RECENT</Text>
                  {recentSentAddresses.map((addr, i) => (
                    <TouchableOpacity
                      key={i}
                      style={styles.recentAddrRow}
                      onPress={() => handleSendAddressSelect(addr)}
                    >
                      <Text style={styles.recentAddrText}>{maskAddr(addr)}</Text>
                      <Text style={styles.recentAddrArrow}>→</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              <Text style={styles.recentHeader}>MY ADDRESSES</Text>
              {allAddresses.map((a, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.recentAddrRow}
                  onPress={() => handleSendAddressSelect(a.address)}
                >
                  <View>
                    <Text style={styles.addrRowLabel}>{a.label || `ADDRESS ${i + 1}`}</Text>
                    <Text style={styles.recentAddrText}>{maskAddr(a.address)}</Text>
                  </View>
                  <Text style={styles.recentAddrArrow}>→</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {sendStep === 'amount' && (
            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={styles.sendStepLabel}>ENTER AMOUNT</Text>

              <View style={styles.sendToCard}>
                <Text style={styles.sendToLabel}>TO</Text>
                <Text style={styles.sendToAddr}>{maskAddr(sendAddress)}</Text>
                <TouchableOpacity onPress={() => setSendStep('address')}>
                  <Text style={styles.changeBtn}>CHANGE</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.amountCard}>
                <TextInput
                  style={styles.amountInput}
                  value={sendAmount}
                  onChangeText={setSendAmount}
                  placeholder="0.00000000"
                  placeholderTextColor={Colors.greenDim}
                  keyboardType="decimal-pad"
                  autoFocus
                />
                <Text style={styles.amountCurrency}>CAP</Text>
              </View>

              {balance !== null && (
                <TouchableOpacity onPress={() => setSendAmount(balance.toFixed(8))}>
                  <Text style={styles.maxBtn}>USE MAX: {balance.toFixed(8)} CAP</Text>
                </TouchableOpacity>
              )}

              {/* ── Fee preset selector (4 buttons) ── */}
              <Text style={styles.feeSelectorLabel}>NETWORK FEE</Text>
              <View style={styles.feePresetRow}>
                {Object.keys(FEE_PRESETS).map((key) => {
                  const preset   = FEE_PRESETS[key];
                  const selected = feePreset === key;
                  const rateText = key === 'CUSTOM'
                    ? '—'
                    : `${preset.rate} scrap/vB`;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.feePresetBtn, selected && styles.feePresetBtnSelected]}
                      onPress={() => setFeePreset(key)}
                    >
                      <Text style={[styles.feePresetLabel, selected && styles.feePresetLabelSelected]}>
                        {preset.label}
                      </Text>
                      <Text style={[styles.feePresetRate, selected && styles.feePresetRateSelected]}>
                        {rateText}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* ── Custom fee input (only when CUSTOM selected) ── */}
              {feePreset === 'CUSTOM' && (
                <View style={styles.customFeeCard}>
                  <Text style={styles.inputLabel}>CUSTOM FEE RATE</Text>
                  <View style={styles.customFeeRow}>
                    <TextInput
                      style={styles.customFeeInput}
                      value={customFee}
                      onChangeText={setCustomFee}
                      placeholder="e.g. 1 (Qt wallet default)"
                      placeholderTextColor={Colors.greenDim}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.customFeeUnit}>scrap/vB</Text>
                  </View>
                  <Text style={styles.customFeeHint}>
                    MIN: 1 scrap/vB
                  </Text>
                  <Text style={styles.customFeeHint}>
                    1 SCRAP = 0.00000001 CAP · 1 CAP = 100,000,000 SCRAPS
                  </Text>
                  <Text style={styles.customFeeHint}>
                    QT WALLET SHOWS: {customFee && parseFloat(customFee) > 0
                      ? `${scrapVbToCapKvb(parseFloat(customFee))} CAP/kvB`
                      : '0.00001 CAP/kvB at 1 scrap/vB'}
                  </Text>
                </View>
              )}

              <Text style={styles.feePresetDesc}>
                {FEE_PRESETS[feePreset].desc}
              </Text>

              <TouchableOpacity
                style={[styles.confirmBtn, (!sendAmount || parseFloat(sendAmount) <= 0) && styles.confirmBtnDisabled]}
                onPress={handleConfirmSend}
                disabled={!sendAmount || parseFloat(sendAmount) <= 0}
              >
                <Text style={styles.confirmBtnText}>REVIEW TRANSACTION →</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {sendStep === 'confirm' && (
            <View style={styles.modalContent}>
              <Text style={styles.sendStepLabel}>CONFIRM TRANSACTION</Text>

              <View style={styles.confirmCard}>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>TO</Text>
                  <Text style={styles.confirmValue} numberOfLines={2}>{sendAddress}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>AMOUNT</Text>
                  <Text style={[styles.confirmValue, { color: Colors.amber }]}>
                    {parseFloat(sendAmount).toFixed(8)} CAP
                  </Text>
                </View>
                <View style={[styles.confirmRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.confirmLabel}>FEE RATE</Text>
                  <Text style={[styles.confirmValue, { color: Colors.amber }]}>
                    {confirmFeeDisplay()}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.confirmBtn, sending && styles.confirmBtnDisabled]}
                onPress={handleExecuteSend}
                disabled={sending}
              >
                <Text style={styles.confirmBtnText}>
                  {sending ? 'BROADCASTING...' : '⚡ CONFIRM SEND'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backBtn}
                onPress={() => setSendStep('amount')}
              >
                <Text style={styles.backBtnText}>← BACK</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* ════════════════════════════════════════
          CAMERA / SCAN MODAL
      ════════════════════════════════════════ */}
      <Modal visible={showScan} animationType="slide" onRequestClose={() => setShowScan(false)}>
        <View style={styles.scannerContainer}>
          <Text style={styles.scannerTitle}>⊡ SCAN ADDRESS</Text>
          <Text style={styles.scannerHint}>POINT CAMERA AT WALLET QR CODE</Text>

          {device ? (
            <Camera
              style={styles.camera}
              device={device}
              isActive={showScan}
              codeScanner={codeScanner}
            />
          ) : (
            <View style={styles.cameraPlaceholder}>
              <Text style={styles.cameraUnavail}>CAMERA UNAVAILABLE</Text>
            </View>
          )}

          <View style={styles.reticleOverlay} pointerEvents="none">
            <View style={styles.reticle} />
          </View>

          <TouchableOpacity style={styles.cancelScanBtn} onPress={() => setShowScan(false)}>
            <Text style={styles.cancelScanText}>[ CANCEL ]</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.black, padding: 14 },

  notReadyContainer: {
    flex: 1, backgroundColor: Colors.black,
    justifyContent: 'center', alignItems: 'center',
  },
  notReadyText: {
    fontFamily: 'ShareTechMono', fontSize: 13,
    color: Colors.greenDim, letterSpacing: 3,
  },

  modeBadge: {
    borderWidth: 1, borderColor: Colors.amberDim,
    paddingVertical: 6, paddingHorizontal: 10,
    marginBottom: 12, alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  modeBadgeText: {
    fontFamily: 'ShareTechMono', fontSize: 10,
    color: Colors.amber, letterSpacing: 2,
  },

  balanceCard: {
    backgroundColor: Colors.surfaceLight,
    borderBottomWidth: 1, borderBottomColor: Colors.borderDim,
    paddingBottom: 18, marginBottom: 16,
  },
  balanceLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 4,
  },
  balanceLabel: {
    fontFamily: 'ShareTechMono', fontSize: 16,
    color: Colors.greenDim, letterSpacing: 2,
  },
  hideBtn: {
    fontFamily: 'ShareTechMono', fontSize: 10,
    color: Colors.greenDim, letterSpacing: 2, opacity: 0.6,
  },
  balanceAmount: {
    fontFamily: 'ShareTechMono', fontSize: 42,
    color: Colors.green,
    textShadowColor: Colors.green, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
    lineHeight: 50,
  },
  balanceCurrency: {
    fontFamily: 'ShareTechMono', fontSize: 28,
    color: Colors.green, letterSpacing: 6, marginBottom: 8, opacity: 0.9,
  },
  identityRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', marginTop: 6, marginBottom: 4,
  },
  verifiedIcon: { color: Colors.greenDim, fontSize: 14 },
  identityToggle: {
    alignSelf:     'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginTop:     4,
    borderWidth:   1,
    borderColor:   Colors.borderDim,
  },
  identityToggleText: {
    fontFamily:    'ShareTechMono',
    fontSize:      9,
    color:         Colors.greenDim,
    letterSpacing: 1,
  },
  rawAddress: {
    fontFamily:    'ShareTechMono',
    fontSize:      11,
    color:         Colors.green,
    letterSpacing: 1,
    textAlign:     'center',
    flex:          1,
  },
  addressLoading: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.greenDim, letterSpacing: 1,
  },
  preWarText: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: '#ffffff', letterSpacing: 1,
    marginTop: 12, fontStyle: 'italic', opacity: 0.6, textAlign: 'center',
  },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  actionBtn: {
    flex: 1, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.borderDim,
    alignItems: 'center', borderRadius: 2,
  },
  primaryBtn: { borderColor: Colors.green },
  actionBtnText: {
    fontFamily: 'ShareTechMono', fontSize: 13,
    color: Colors.green, letterSpacing: 2,
  },
  actionBtnTextPrimary: {
    fontFamily: 'ShareTechMono', fontSize: 13,
    color: Colors.green, letterSpacing: 2,
  },

  unitEduCard: {
    borderWidth: 1, borderColor: Colors.borderDim,
    backgroundColor: Colors.surface,
    padding: 10, marginBottom: 14,
  },
  unitEduTitle: {
    fontFamily: 'ShareTechMono', fontSize: 10,
    color: Colors.amber, letterSpacing: 2, marginBottom: 4,
  },
  unitEduLine: {
    fontFamily: 'ShareTechMono', fontSize: 13,
    color: Colors.green, letterSpacing: 1,
  },
  unitEduSub: {
    fontFamily: 'ShareTechMono', fontSize: 10,
    color: Colors.greenDim, letterSpacing: 1, marginTop: 3, opacity: 0.8,
  },
  sectionHeader: {
    fontFamily: 'ShareTechMono', fontSize: 13,
    color: Colors.greenDim, marginBottom: 10, paddingBottom: 5,
    borderBottomWidth: 1, borderBottomColor: Colors.border, letterSpacing: 2,
  },
  emptyText: {
    fontFamily: 'ShareTechMono', fontSize: 13,
    color: Colors.greenDim, textAlign: 'center', marginTop: 24, letterSpacing: 1,
  },
  txItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, borderLeftWidth: 3, marginBottom: 6,
  },
  txReceived: { borderLeftColor: Colors.green },
  txSent:     { borderLeftColor: Colors.red },
  txLeft:     { flex: 1, marginRight: 12 },
  txType: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.green, letterSpacing: 1, marginBottom: 3,
  },
  txTime: {
    fontFamily: 'ShareTechMono', fontSize: 11,
    color: Colors.greenDim, marginBottom: 2,
  },
  txId: {
    fontFamily: 'ShareTechMono', fontSize: 10,
    color: Colors.greenDim, opacity: 0.7,
  },
  txAmount: { fontFamily: 'ShareTechMono', fontSize: 14 },
  showMoreBtn: {
    borderWidth: 1, borderColor: Colors.border,
    paddingVertical: 12, alignItems: 'center', marginBottom: 8,
  },
  showMoreText: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.greenDim, letterSpacing: 2,
  },

  modalContainer: { flex: 1, backgroundColor: Colors.black },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, paddingTop: 52,
    borderBottomWidth: 1, borderBottomColor: Colors.borderDim,
    backgroundColor: Colors.surfaceLight,
  },
  modalTitle: {
    fontFamily: 'ShareTechMono', fontSize: 18,
    color: Colors.green, letterSpacing: 3,
  },
  modalClose: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.greenDim, letterSpacing: 1,
  },
  modalContent: { padding: 20 },

  receiveHint: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.greenDim, letterSpacing: 2, marginBottom: 24, textAlign: 'center',
  },
  qrPlaceholder: {
    width: 220, height: 220,
    borderWidth: 1, borderColor: Colors.green,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 24, backgroundColor: Colors.surface, alignSelf: 'center',
  },
  qrIcon:  { fontSize: 56, color: Colors.green, opacity: 0.3 },
  qrLabel: {
    fontFamily: 'ShareTechMono', fontSize: 11,
    color: Colors.greenDim, letterSpacing: 2, marginTop: 8,
  },
  addressBox: {
    borderWidth: 1, borderColor: Colors.green,
    backgroundColor: Colors.surface, padding: 14, marginBottom: 16,
  },
  addressBoxText: {
    fontFamily: 'ShareTechMono', fontSize: 13,
    color: Colors.green, textAlign: 'center', lineHeight: 22,
  },
  copyBtn: {
    borderWidth: 1, borderColor: Colors.green,
    paddingVertical: 14, alignItems: 'center', marginBottom: 24,
  },
  copyBtnDone:     { backgroundColor: Colors.green },
  copyBtnText:     { fontFamily: 'ShareTechMono', fontSize: 12, color: Colors.green, letterSpacing: 2 },
  copyBtnTextDone: { color: Colors.black },
  allAddrHeader: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.greenDim, letterSpacing: 2, marginBottom: 8,
  },
  addrRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, padding: 10, marginBottom: 4,
  },
  addrRowLabel: { fontFamily: 'ShareTechMono', fontSize: 11, color: Colors.greenDim, letterSpacing: 1 },
  addrRowAddr:  { fontFamily: 'ShareTechMono', fontSize: 11, color: Colors.green },

  sendStepLabel: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.greenDim, letterSpacing: 3, marginBottom: 20,
  },
  scanNewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.green,
    paddingVertical: 16, marginBottom: 16, gap: 10,
  },
  scanNewIcon: { fontSize: 22, color: Colors.green },
  scanNewText: {
    fontFamily: 'ShareTechMono', fontSize: 14,
    color: Colors.green, letterSpacing: 2,
  },
  manualEntryCard: {
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, padding: 12, marginBottom: 20,
  },
  inputLabel: {
    fontFamily: 'ShareTechMono', fontSize: 10,
    color: Colors.greenDim, letterSpacing: 2, marginBottom: 8,
  },
  addrInput: {
    backgroundColor: Colors.black, borderWidth: 1, borderColor: Colors.borderDim,
    color: Colors.green, fontFamily: 'ShareTechMono', fontSize: 12,
    padding: 10, letterSpacing: 1,
  },
  nextBtn: {
    marginTop: 10, borderWidth: 1, borderColor: Colors.green,
    paddingVertical: 10, alignItems: 'center',
  },
  nextBtnText: {
    fontFamily: 'ShareTechMono', fontSize: 13,
    color: Colors.green, letterSpacing: 2,
  },
  recentHeader: {
    fontFamily: 'ShareTechMono', fontSize: 11,
    color: Colors.greenDim, letterSpacing: 3,
    marginBottom: 8, marginTop: 4,
    borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 4,
  },
  recentAddrRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, padding: 12, marginBottom: 4,
  },
  recentAddrText: { fontFamily: 'ShareTechMono', fontSize: 12, color: Colors.green },
  recentAddrArrow: { fontFamily: 'ShareTechMono', fontSize: 16, color: Colors.greenDim },

  sendToCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, padding: 12, marginBottom: 16,
  },
  sendToLabel: { fontFamily: 'ShareTechMono', fontSize: 11, color: Colors.greenDim, letterSpacing: 2 },
  sendToAddr:  { fontFamily: 'ShareTechMono', fontSize: 12, color: Colors.green, flex: 1, marginHorizontal: 8 },
  changeBtn:   { fontFamily: 'ShareTechMono', fontSize: 11, color: Colors.amber, letterSpacing: 1 },
  amountCard: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.green,
    backgroundColor: Colors.surface, padding: 12, marginBottom: 8,
  },
  amountInput: {
    flex: 1, fontFamily: 'ShareTechMono', fontSize: 28,
    color: Colors.green, padding: 0,
  },
  amountCurrency: {
    fontFamily: 'ShareTechMono', fontSize: 16,
    color: Colors.greenDim, letterSpacing: 2,
  },
  maxBtn: {
    fontFamily: 'ShareTechMono', fontSize: 11,
    color: Colors.amber, letterSpacing: 1, marginBottom: 16,
  },

  // ── Fee preset selector ──
  feeSelectorLabel: {
    fontFamily: 'ShareTechMono', fontSize: 11,
    color: Colors.greenDim, letterSpacing: 2, marginBottom: 8,
  },
  feePresetRow: {
    flexDirection: 'row', gap: 4, marginBottom: 6,
  },
  feePresetBtn: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 2,
    borderWidth: 1, borderColor: Colors.borderDim,
    backgroundColor: Colors.surface, alignItems: 'center',
  },
  feePresetBtnSelected: {
    borderColor: Colors.green,
    backgroundColor: Colors.surfaceLight,
  },
  feePresetLabel: {
    fontFamily: 'ShareTechMono', fontSize: 10,
    color: Colors.greenDim, letterSpacing: 1,
  },
  feePresetLabelSelected: {
    color: Colors.green,
  },
  feePresetRate: {
    fontFamily: 'ShareTechMono', fontSize: 9,
    color: Colors.greenDim, marginTop: 2, opacity: 0.7,
  },
  feePresetRateSelected: {
    color: Colors.green, opacity: 1,
  },
  feePresetDesc: {
    fontFamily: 'ShareTechMono', fontSize: 10,
    color: Colors.amber, letterSpacing: 1, marginBottom: 20,
    textAlign: 'center', opacity: 0.7,
  },

  // ── Custom fee input ──
  customFeeCard: {
    borderWidth: 1, borderColor: Colors.amber,
    backgroundColor: Colors.surface, padding: 12, marginTop: 6, marginBottom: 6,
  },
  customFeeRow: {
    flexDirection: 'row', alignItems: 'center',
  },
  customFeeInput: {
    flex: 1,
    backgroundColor: Colors.black, borderWidth: 1, borderColor: Colors.borderDim,
    color: Colors.green, fontFamily: 'ShareTechMono', fontSize: 16,
    padding: 10, letterSpacing: 1,
  },
  customFeeUnit: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.amber, letterSpacing: 1, marginLeft: 10,
  },
  customFeeHint: {
    fontFamily: 'ShareTechMono', fontSize: 9,
    color: Colors.greenDim, letterSpacing: 1, marginTop: 8,
    opacity: 0.8,
  },

  confirmBtn: {
    borderWidth: 1, borderColor: Colors.green,
    paddingVertical: 16, alignItems: 'center', marginBottom: 12,
  },
  confirmBtnDisabled: { borderColor: Colors.borderDim, opacity: 0.4 },
  confirmBtnText: {
    fontFamily: 'ShareTechMono', fontSize: 14,
    color: Colors.green, letterSpacing: 2,
  },
  confirmCard: {
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, marginBottom: 24,
  },
  confirmRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  confirmLabel: {
    fontFamily: 'ShareTechMono', fontSize: 11,
    color: Colors.greenDim, letterSpacing: 2, width: 80,
  },
  confirmValue: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.green, flex: 1, textAlign: 'right',
  },
  backBtn: { alignItems: 'center', paddingVertical: 12 },
  backBtnText: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.greenDim, letterSpacing: 2,
  },

  scannerContainer: {
    flex: 1, backgroundColor: Colors.black,
    alignItems: 'center', paddingTop: 60,
  },
  scannerTitle: {
    fontFamily: 'ShareTechMono', fontSize: 18,
    color: Colors.green, letterSpacing: 3, marginBottom: 6,
  },
  scannerHint: {
    fontFamily: 'ShareTechMono', fontSize: 12,
    color: Colors.greenDim, letterSpacing: 1.5, marginBottom: 24,
  },
  camera:      { width: '100%', flex: 1 },
  cameraPlaceholder: {
    width: '100%', flex: 1,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.green, opacity: 0.4,
  },
  cameraUnavail: {
    fontFamily: 'ShareTechMono', fontSize: 13,
    color: Colors.greenDim, letterSpacing: 2,
  },
  reticleOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 80,
    justifyContent: 'center', alignItems: 'center',
  },
  reticle: {
    width: 220, height: 220,
    borderWidth: 2, borderColor: Colors.green, borderRadius: 8, opacity: 0.8,
  },
  cancelScanBtn: { paddingVertical: 20, paddingHorizontal: 40 },
  cancelScanText: {
    fontFamily: 'ShareTechMono', fontSize: 13,
    color: Colors.green, letterSpacing: 2,
  },
});

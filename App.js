// App.js v1.0 — CapStash Wallet Lite
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Animated,
  StatusBar, StyleSheet, Easing,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import WalletScreen       from './screens/WalletScreen';
import NetworkScreen      from './screens/NetworkScreen';
import SeedGenerateScreen from './screens/SeedGenerateScreen';
import SeedVerifyScreen   from './screens/SeedVerifyScreen';
import SeedRestoreScreen  from './screens/SeedRestoreScreen';
import FieldManual        from './components/FieldManual';
import SetupMenu          from './components/Setupmenu';

import { getBlockCount, getMiningInfo, getBlockchainInfo, loadNodeConfig } from './services/rpc';
import { ensureWandererWallet } from './services/walletManager';
import { startNode } from './services/nodeService';
import Colors from './theme/colors';

// ── App modes ─────────────────────────────────────────────
const MODE_LOCAL  = 'LOCAL';   // bundles local capstashd node
const MODE_REMOTE = 'REMOTE';  // connects to remote/community node via Tailscale

// ── Local node config (same as old WANDERER_NODE_CONFIG) ──
const LOCAL_NODE_CONFIG = {
  host: '127.0.0.1',
  port: 8332,
  user: 'capstash',
  pass: 'localnode',
};

// ── AsyncStorage helpers ──────────────────────────────────
const persistMode  = async (m) => AsyncStorage.setItem('@capstash_app_mode', m);
const clearAppMode = async ()  => AsyncStorage.removeItem('@capstash_app_mode');
const loadAppMode  = async ()  => AsyncStorage.getItem('@capstash_app_mode');

// ── Default remote node placeholder ──────────────────────
const DEFAULT_NODE = {
  ip:          '100.x.x.x',
  port:        '8332',
  rpcuser:     'capstashuser',
  rpcpassword: 'wasteland',
};

// ── Node sync status for header ☢ indicator ──────────────
// RED   = no connection / node not running
// AMBER = connected but still syncing (verificationprogress < 0.95)
// GREEN = fully synced (verificationprogress >= 0.95)
const NODE_STATUS = { RED: 'red', AMBER: 'amber', GREEN: 'green' };

const Tab = createBottomTabNavigator();

export default function App() {
  const [blockHeight, setBlockHeight] = useState(0);
  const [networkHash, setNetworkHash] = useState(0);
  const [difficulty,  setDifficulty]  = useState(0);
  const [isOnline,    setIsOnline]    = useState(true);
  const [showManual,  setShowManual]  = useState(false);
  const [showSetup,   setShowSetup]   = useState(false);
  const [nodeConfig,  setNodeConfig]  = useState(DEFAULT_NODE);
  const [appMode,     setAppMode]     = useState(null);   // null = not yet chosen
  const [configReady, setConfigReady] = useState(false);
  const [seedPhase,   setSeedPhase]   = useState(null);   // null | 'generate' | 'verify' | 'restore'
  const [pendingSeed, setPendingSeed] = useState(null);

  // ── Local node wallet state ───────────────────────────
  const [walletAddress, setWalletAddress] = useState(null);
  const [walletReady,   setWalletReady]   = useState(false);

  // ── Node sync status — drives ☢ icon color ───────────
  const [nodeStatus, setNodeStatus] = useState(NODE_STATUS.RED);

  const tickerAnim = useRef(new Animated.Value(0)).current;

  // ── Load persisted app mode on boot ──────────────────
  useEffect(() => {
    loadAppMode().then(m => {
      console.log('[App] loadAppMode returned:', JSON.stringify(m));
      if (m === MODE_LOCAL)  { setAppMode(MODE_LOCAL);  return; }
      if (m === MODE_REMOTE) { setAppMode(MODE_REMOTE); return; }
      // Clear any legacy Wanderer/Drifter values from old wallet-android installs
      if (m) clearAppMode();
      setAppMode(null);
    });
  }, []);

  // ── Load persisted remote node config on boot ────────
  useEffect(() => {
    loadNodeConfig().then(cfg => {
      if (cfg && typeof cfg === 'object') setNodeConfig(cfg);
      else setNodeConfig(DEFAULT_NODE);
      setConfigReady(true);
    });
  }, []);

  // ── Local mode — force nodeConfig to localhost ───────
  useEffect(() => {
    if (appMode !== MODE_LOCAL) return;
    setNodeConfig({
      ip:          LOCAL_NODE_CONFIG.host,
      port:        String(LOCAL_NODE_CONFIG.port),
      rpcuser:     LOCAL_NODE_CONFIG.user,
      rpcpassword: LOCAL_NODE_CONFIG.pass,
      localMode:   true,
    });
  }, [appMode]);

  // ── Local mode boot — start node then init wallet ────
  // UI loads immediately. Node starts in background.
  // ensureWandererWallet called after 5s delay for capstashd startup.
  useEffect(() => {
    if (appMode !== MODE_LOCAL || !configReady || seedPhase !== null) return;

    const localCfg = {
      ip:          LOCAL_NODE_CONFIG.host,
      port:        String(LOCAL_NODE_CONFIG.port),
      rpcuser:     LOCAL_NODE_CONFIG.user,
      rpcpassword: LOCAL_NODE_CONFIG.pass,
      localMode:   true,
    };

    console.log('[App] Local mode boot — starting node...');

    startNode()
      .catch(e => console.warn('[App] startNode error:', e.message))
      .then(() => new Promise(resolve => setTimeout(resolve, 5000)))
      .then(() => ensureWandererWallet(localCfg, pendingSeed))
      .then(result => {
        console.log('[App] ensureWandererWallet result:', JSON.stringify(result));
        if (result.ready) {
          setWalletAddress(result.address);
          setWalletReady(true);
        } else {
          // Not fatal — node status indicator will show RED until node comes up
          console.warn('[App] Wallet init failed:', result.error);
        }
      })
      .catch(e => console.error('[App] Local boot error:', e.message));

  }, [appMode, configReady, seedPhase, pendingSeed]);

  // ── Handle mode selection ───────────────────────────
  const handleModeSelected = async (mode) => {
    if (mode === MODE_LOCAL) {
      // Check if local wallet was already created
      const alreadyInit = await AsyncStorage.getItem('@capstash_wanderer_wallet_init');
      if (alreadyInit === 'true') {
        // Wallet exists — skip seed flow
        await persistMode(MODE_LOCAL);
        setAppMode(MODE_LOCAL);
        return;
      }
      // First time — ask create or restore
      setSeedPhase('choice');
      setAppMode(MODE_LOCAL);
      return;
    }
    // Remote mode
    await persistMode(mode);
    setWalletAddress(null);
    setWalletReady(false);
    setNodeStatus(NODE_STATUS.RED);
    const cfg = await loadNodeConfig();
    if (cfg && !cfg.localMode) setNodeConfig(cfg);
    else setNodeConfig(DEFAULT_NODE);
    setAppMode(mode);
  };

  // ── Poll node stats every 30s ─────────────────────────
  useEffect(() => {
    if (!configReady || !nodeConfig || !appMode) return;

    const poll = async () => {
      try {
        const [h, mining] = await Promise.all([
          getBlockCount(nodeConfig),
          getMiningInfo(nodeConfig),
        ]);
        setBlockHeight(h);
        setDifficulty(mining?.difficulty     || 0);
        setNetworkHash(mining?.networkhashps || 0);
        setIsOnline(true);

        // Local mode: also check sync progress for status dot
        if (appMode === MODE_LOCAL) {
          try {
            const chainInfo = await getBlockchainInfo(nodeConfig);
            const progress = chainInfo?.verificationprogress || 0;
            setNodeStatus(progress >= 0.95 ? NODE_STATUS.GREEN : NODE_STATUS.AMBER);
          } catch {
            setNodeStatus(NODE_STATUS.AMBER);
          }
        } else {
          // Remote mode — if we got a response, we're connected
          setNodeStatus(NODE_STATUS.GREEN);
        }

      } catch {
        setIsOnline(false);
        setNodeStatus(NODE_STATUS.RED);
      }
    };

    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, [nodeConfig, configReady, appMode]);

  // ── Formatters ────────────────────────────────────────
  const formatHash = (hs) => {
    if (!hs || hs === 0) return '-- H/s';
    if (hs >= 1e9) return `${(hs / 1e9).toFixed(2)} GH/s`;
    if (hs >= 1e6) return `${(hs / 1e6).toFixed(2)} MH/s`;
    if (hs >= 1e3) return `${(hs / 1e3).toFixed(0)} KH/s`;
    return `${hs.toFixed(0)} H/s`;
  };

  const formatDiff = (d) => {
    if (!d || d === 0) return '--';
    if (d >= 1e9) return `${(d / 1e9).toFixed(3)}B`;
    if (d >= 1e6) return `${(d / 1e6).toFixed(3)}M`;
    if (d >= 1e3) return `${(d / 1e3).toFixed(3)}K`;
    return d.toFixed(3);
  };

  // ── Status dot color ──────────────────────────────────
  const statusColor =
    nodeStatus === NODE_STATUS.GREEN ? Colors.green :
    nodeStatus === NODE_STATUS.AMBER ? Colors.amber :
    Colors.red;

  const tickerSegment = `◈ NET ${formatHash(networkHash)}--DIFF ${formatDiff(difficulty)}--BLK #${blockHeight}---STAY VIGILANT · STAY SAFE · STACK CAPS---`;
  const TICKER_SCROLL = tickerSegment.length * 10.0;

  useEffect(() => {
    tickerAnim.setValue(0);
    Animated.timing(tickerAnim, {
      toValue:         1,
      duration:        60000,
      easing:          Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [networkHash, difficulty, blockHeight]);

  // ── Mode not yet chosen — show mode select screen ────
  if (configReady && appMode === null) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.black} />
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.modeSelectContainer}>

            <Text style={styles.logo}>CapStash</Text>
            <Text style={styles.modeSelectSubtitle}>WALLET LITE</Text>

            <View style={styles.modeSelectDivider} />

            <Text style={styles.modeSelectPrompt}>SELECT NODE MODE</Text>

            {/* Local node button */}
            <TouchableOpacity
              style={styles.modeBtn}
              onPress={() => handleModeSelected(MODE_LOCAL)}
            >
              <Text style={styles.modeBtnTitle}>⬡  LOCAL NODE</Text>
              <Text style={styles.modeBtnDesc}>
                Runs a full CapStash node on this device.{'\n'}
                Self-sovereign. No trust required.
              </Text>
            </TouchableOpacity>

            {/* Remote node button */}
            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnDim]}
              onPress={() => handleModeSelected(MODE_REMOTE)}
            >
              <Text style={[styles.modeBtnTitle, { color: Colors.amber }]}>∿  REMOTE NODE</Text>
              <Text style={styles.modeBtnDesc}>
                Connect to a community or personal node.{'\n'}
                Lightweight. Requires Tailscale or reachable RPC.
              </Text>
            </TouchableOpacity>

          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }
// ── Wallet choice — new or restore ───────────────────
  if (seedPhase === 'choice') {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.black} />
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.modeSelectContainer}>

            <Text style={styles.logo}>CapStash</Text>
            <Text style={styles.modeSelectSubtitle}>LOCAL WALLET</Text>
            <View style={styles.modeSelectDivider} />
            <Text style={styles.modeSelectPrompt}>WALLET SETUP</Text>

            <TouchableOpacity
              style={styles.modeBtn}
              onPress={() => setSeedPhase('generate')}
            >
              <Text style={styles.modeBtnTitle}>⬡  NEW WALLET</Text>
              <Text style={styles.modeBtnDesc}>
                Generate a new seed phrase.{'\n'}
                First time using CapStash on this device.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, styles.modeBtnDim]}
              onPress={() => setSeedPhase('restore')}
            >
              <Text style={[styles.modeBtnTitle, { color: Colors.amber }]}>∿  RESTORE WALLET</Text>
              <Text style={styles.modeBtnDesc}>
                Already have a seed phrase?{'\n'}
                Restore from an existing CapStash wallet.
              </Text>
            </TouchableOpacity>

          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }
  // ── Seed phrase flow ──────────────────────────────────
  if (seedPhase === 'generate') {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.black} />
        <SeedGenerateScreen
          onSeedConfirmed={(mnemonic) => {
            setPendingSeed(mnemonic);
            setSeedPhase('verify');
          }}
          onRestoreInstead={() => setSeedPhase('restore')}
        />
      </SafeAreaProvider>
    );
  }

  if (seedPhase === 'verify') {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.black} />
        <SeedVerifyScreen
          mnemonic={pendingSeed}
          onBack={() => setSeedPhase('generate')}
          onVerified={async () => {
            await persistMode(MODE_LOCAL);
            setSeedPhase(null);
          }}
        />
      </SafeAreaProvider>
    );
  }

  if (seedPhase === 'restore') {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.black} />
        <SeedRestoreScreen
          onBack={() => setSeedPhase('choice')}
          onSeedRestored={async (mnemonic) => {
            setPendingSeed(mnemonic);
            await persistMode(MODE_LOCAL);
            setSeedPhase(null);
          }}
        />
      </SafeAreaProvider>
    );
  }

  // ── Main app ──────────────────────────────────────────
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.black} />
        <SafeAreaView style={styles.container} edges={['top']}>

          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={styles.logoBlock}>
              <Text style={styles.logo}>CapStash</Text>
            </View>
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.statusRow}
                onPress={() => setShowSetup(true)}
              >
                <Text style={[styles.statusIcon, { color: statusColor }]}>☢</Text>
                <Text style={[styles.modeText, { color: statusColor, textShadowColor: statusColor }]}>
                  {appMode || 'REMOTE'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.manualBtn} onPress={() => setShowManual(true)}>
                <Text style={styles.manualBtnText}>B.S.G.</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Ticker ── */}
          <View style={styles.ticker}>
            <Animated.Text
              style={[
                styles.tickerText,
                {
                  transform: [{
                    translateX: tickerAnim.interpolate({
                      inputRange:  [0, 1],
                      outputRange: [400, -(TICKER_SCROLL + 400)],
                    }),
                  }],
                },
              ]}
            >
              {tickerSegment}
            </Animated.Text>
          </View>

          {/* ── Tabs ── */}
          {!configReady ? (
            <View style={styles.initContainer}>
              <Text style={styles.initText}>INITIALIZING...</Text>
            </View>
          ) : (
            <Tab.Navigator
              screenOptions={({ route }) => ({
                headerShown:             false,
                tabBarStyle:             styles.tabBar,
                tabBarActiveTintColor:   Colors.green,
                tabBarInactiveTintColor: Colors.greenDim,
                tabBarLabelStyle:        styles.tabLabel,
                tabBarIcon: ({ focused }) => {
                  const icons = { VAULT: '⬡', SIGNAL: '∿' };
                  return (
                    <Text style={{
                      fontSize: focused ? 32 : 22,
                      color:    focused ? Colors.green : Colors.greenDim,
                      opacity:  focused ? 1 : 0.6,
                    }}>
                      {icons[route.name]}
                    </Text>
                  );
                },
              })}
            >
              <Tab.Screen name="VAULT">
                {() => (
                  <WalletScreen
                    nodeConfig={nodeConfig}
                    isOnline={isOnline}
                    appMode={appMode}
                    walletReady={walletReady || appMode === MODE_REMOTE}
                    wandererAddress={walletAddress}
                  />
                )}
              </Tab.Screen>

              <Tab.Screen name="SIGNAL">
                {() => (
                  <NetworkScreen
                    nodeConfig={nodeConfig}
                    appMode={appMode}
                  />
                )}
              </Tab.Screen>
            </Tab.Navigator>
          )}

        </SafeAreaView>

        {/* ── Setup Menu ── */}
        <SetupMenu
          visible={showSetup}
          onClose={() => setShowSetup(false)}
          isOnline={isOnline}
          nodeConfig={nodeConfig}
          appMode={appMode}
          onNodeConfigChange={setNodeConfig}
          onModeChange={handleModeSelected}
        />

        <FieldManual visible={showManual} onClose={() => setShowManual(false)} />

      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.black },
  initContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.black },
  initText:      { fontFamily: 'ShareTechMono', fontSize: 14, color: Colors.green, letterSpacing: 3 },

  // ── Mode select screen ──
  modeSelectContainer: {
    flex:            1,
    backgroundColor: Colors.black,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 30,
  },
  modeSelectSubtitle: {
    fontFamily:    'ShareTechMono',
    fontSize:      13,
    color:         Colors.greenDim,
    letterSpacing: 6,
    marginTop:     -8,
    marginBottom:  20,
  },
  modeSelectDivider: {
    width:           '100%',
    height:          1,
    backgroundColor: Colors.borderDim,
    marginBottom:    30,
  },
  modeSelectPrompt: {
    fontFamily:    'ShareTechMono',
    fontSize:      11,
    color:         Colors.greenDim,
    letterSpacing: 4,
    marginBottom:  20,
  },
  modeBtn: {
    width:           '100%',
    borderWidth:     1,
    borderColor:     Colors.green,
    padding:         18,
    marginBottom:    16,
    backgroundColor: '#050f05',
  },
  modeBtnDim: {
    borderColor: Colors.amber,
  },
  modeBtnTitle: {
    fontFamily:    'ShareTechMono',
    fontSize:      15,
    color:         Colors.green,
    letterSpacing: 2,
    marginBottom:  8,
  },
  modeBtnDesc: {
    fontFamily: 'ShareTechMono',
    fontSize:   11,
    color:      Colors.greenDim,
    lineHeight: 18,
  },

  // ── Header ──
  header: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingTop:        10,
    paddingBottom:     10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderDim,
    backgroundColor:   Colors.surfaceLight,
  },
  logoBlock: { flexDirection: 'column' },
  logo: {
    fontFamily:       'ShareTechMono',
    fontSize:         38,
    color:            Colors.green,
    textShadowColor:  Colors.green,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
    letterSpacing:    4,
    lineHeight:       44,
  },
  headerRight: { alignItems: 'flex-end', gap: 8 },
  statusRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusIcon:  { fontSize: 20 },
  modeText: {
    fontFamily:       'ShareTechMono',
    fontSize:         22,
    letterSpacing:    3,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  manualBtn: {
    borderWidth:       1,
    borderColor:       Colors.borderDim,
    paddingHorizontal: 10,
    paddingVertical:   5,
  },
  manualBtnText: {
    fontFamily:    'ShareTechMono',
    fontSize:      13,
    color:         Colors.greenDim,
    letterSpacing: 2,
  },

  // ── Ticker ──
  ticker: {
    backgroundColor:   '#1a0500',
    borderTopWidth:    1,
    borderTopColor:    '#3a0a00',
    borderBottomWidth: 1,
    borderBottomColor: '#3a0a00',
    height:            26,
    overflow:          'hidden',
  },
  tickerText: {
    fontFamily:    'ShareTechMono',
    fontSize:      12,
    color:         Colors.amber,
    letterSpacing: 1,
    lineHeight:    26,
    position:      'absolute',
    top:           0,
    width:         2000,
  },

  // ── Tab bar ──
  tabBar: {
    backgroundColor: Colors.surfaceLight,
    borderTopWidth:  1,
    borderTopColor:  Colors.borderDim,
    paddingTop:      4,
    height:          64,
  },
  tabLabel: {
    fontFamily:    'ShareTechMono',
    fontSize:      10,
    letterSpacing: 1,
    marginBottom:  2,
  },
});

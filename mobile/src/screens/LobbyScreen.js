import React, {useState, useEffect, useRef} from 'react';
import {
  View, Text, StyleSheet, Animated, Easing,
  TouchableOpacity, Alert, Pressable,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, spacing, font, radii} from '../theme';
import ArgueButton from '../components/ArgueButton';
import {connectAndAuthenticate, disconnectSocket, getSocket} from '../services/socket';

export default function LobbyScreen({navigation}) {
  const insets = useSafeAreaInsets();
  const [searching, setSearching] = useState(false);
  const [stage, setStage] = useState(0);
  const [waitSecs, setWaitSecs] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;
  const ring  = useRef(new Animated.Value(1)).current;
  const timer = useRef(null);

  useEffect(() => {
    return () => {
      clearInterval(timer.current);
      const s = getSocket();
      s?.off('matchFound');
      s?.off('matchCancelled');
    };
  }, []);

  function startPulse() {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 1.08, duration: 800, easing: Easing.out(Easing.ease), useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 1,    duration: 800, easing: Easing.in(Easing.ease),  useNativeDriver: true}),
      ]),
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(ring, {toValue: 1.5, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true}),
        Animated.timing(ring, {toValue: 1,   duration: 0,    useNativeDriver: true}),
      ]),
    ).start();
  }

  async function startSearch() {
    try {
      setSearching(true);
      setStage(0);
      setWaitSecs(0);
      startPulse();
      const s = await connectAndAuthenticate();
      setStage(1);
      timer.current = setInterval(() => setWaitSecs(w => w + 1), 1000);
      s.emit('enterQueue');
      s.once('matchFound', ({debateId, opponentName}) => {
        setStage(2);
        clearInterval(timer.current);
        pulse.stopAnimation();
        ring.stopAnimation();
        setTimeout(() => {
          setSearching(false);
          navigation.navigate('Debate', {debateId, opponentName});
        }, 600);
      });
      s.once('matchCancelled', () => cancelSearch());
    } catch (e) {
      Alert.alert('Connection failed', e.message);
      setSearching(false);
    }
  }

  function cancelSearch() {
    getSocket()?.emit('leaveQueue');
    getSocket()?.off('matchFound');
    disconnectSocket();
    clearInterval(timer.current);
    pulse.stopAnimation();
    ring.stopAnimation();
    pulse.setValue(1);
    ring.setValue(1);
    setSearching(false);
    setStage(0);
    setWaitSecs(0);
  }

  const mins = String(Math.floor(waitSecs / 60)).padStart(2, '0');
  const secs = String(waitSecs % 60).padStart(2, '0');

  const stages = ['Connecting…', 'Finding opponent…', 'Match found!'];

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>

      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          style={styles.iconBtn}
          onPress={() => navigation.navigate('Notifications')}>
          <Text style={styles.iconBtnText}>🔔</Text>
        </Pressable>
        <Pressable
          style={styles.iconBtn}
          onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.iconBtnText}>⚙️</Text>
        </Pressable>
      </View>

      {/* Orb area */}
      <View style={styles.orbArea}>
        {searching && (
          <Animated.View style={[
            styles.orbRing,
            {transform: [{scale: ring}], opacity: ring.interpolate({inputRange:[1,1.5],outputRange:[0.4,0]})}
          ]} />
        )}
        <Animated.View style={[styles.orbOuter, {transform: [{scale: pulse}]}]}>
          <View style={[styles.orbInner, searching && styles.orbInnerActive]}>
            <Text style={styles.orbIcon}>{searching ? (stage === 2 ? '⚡' : '🔍') : '⚡'}</Text>
          </View>
        </Animated.View>

        {searching ? (
          <View style={styles.statusArea}>
            <Text style={styles.stageText}>{stages[stage]}</Text>
            <Text style={styles.timer}>{mins}:{secs}</Text>
          </View>
        ) : (
          <View style={styles.statusArea}>
            <Text style={styles.idleTitle}>Ready to argue?</Text>
            <Text style={styles.idleSub}>Get matched with someone who disagrees</Text>
          </View>
        )}
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {!searching ? (
          <>
            <ArgueButton label="Start Debating" onPress={startSearch} />
            <TouchableOpacity
              style={styles.watchLiveBtn}
              onPress={() => navigation.navigate('WatchLive')}>
              <Text style={styles.watchLiveIcon}>📺</Text>
              <Text style={styles.watchLiveText}>Watch Live Debates</Text>
            </TouchableOpacity>
          </>
        ) : (
          <ArgueButton label="Cancel Search" onPress={cancelSearch} variant="ghost" />
        )}
      </View>

      {/* Bottom spacer for tab bar */}
      <View style={{height: insets.bottom + 16}} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  iconBtn: {
    width: 44, height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnText: {fontSize: 20},
  orbArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  orbRing: {
    position: 'absolute',
    width: 180, height: 180,
    borderRadius: 90,
    borderWidth: 2,
    borderColor: colors.purple,
  },
  orbOuter: {
    width: 140, height: 140,
    borderRadius: 70,
    backgroundColor: colors.purpleDim,
    alignItems: 'center', justifyContent: 'center',
  },
  orbInner: {
    width: 100, height: 100,
    borderRadius: 50,
    backgroundColor: colors.purple,
    alignItems: 'center', justifyContent: 'center',
  },
  orbInnerActive: {backgroundColor: '#7c3aed'},
  orbIcon: {fontSize: 42},
  statusArea: {alignItems: 'center', gap: spacing.xs},
  stageText: {fontSize: font.base, color: colors.text, fontWeight: '600'},
  timer: {
    fontSize: font.xl, color: colors.purple,
    fontWeight: '800', fontVariant: ['tabular-nums'],
  },
  idleTitle: {fontSize: font.lg, fontWeight: '700', color: colors.text},
  idleSub: {fontSize: font.sm, color: colors.textMuted, textAlign: 'center'},
  actions: {gap: spacing.sm, paddingBottom: spacing.md},
  watchLiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    borderRadius: radii.md,
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
  },
  watchLiveIcon: {fontSize: 20},
  watchLiveText: {fontSize: font.sm, color: colors.textMuted, fontWeight: '600'},
});

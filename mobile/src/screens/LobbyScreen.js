import React, {useState, useEffect, useRef} from 'react';
import {
  View, Text, StyleSheet, Animated, Easing, TouchableOpacity, Alert,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, spacing, font, radii} from '../theme';
import ArgueButton from '../components/ArgueButton';
import GlassCard from '../components/GlassCard';
import {connectAndAuthenticate, disconnectSocket, getSocket} from '../services/socket';

const STAGES = ['Connecting…', 'Finding opponent…', 'Match found!'];

export default function LobbyScreen({navigation}) {
  const insets = useSafeAreaInsets();
  const [searching, setSearching] = useState(false);
  const [stage, setStage] = useState(0);
  const [waitSecs, setWaitSecs] = useState(0);
  const pulse = useRef(new Animated.Value(1)).current;
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
        Animated.timing(pulse, {toValue: 1.12, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 1,    duration: 900, easing: Easing.in(Easing.ease),  useNativeDriver: true}),
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
        setTimeout(() => {
          setSearching(false);
          navigation.navigate('Debate', {debateId, opponentName});
        }, 800);
      });
      s.once('matchCancelled', () => cancelSearch());
    } catch (e) {
      Alert.alert('Connection failed', e.message);
      setSearching(false);
    }
  }

  function cancelSearch() {
    const s = getSocket();
    s?.emit('leaveQueue');
    s?.off('matchFound');
    disconnectSocket();
    clearInterval(timer.current);
    pulse.stopAnimation();
    pulse.setValue(1);
    setSearching(false);
    setStage(0);
    setWaitSecs(0);
  }

  const mins = String(Math.floor(waitSecs / 60)).padStart(2, '0');
  const secs = String(waitSecs % 60).padStart(2, '0');

  return (
    <View style={[styles.root, {paddingBottom: insets.bottom + spacing.md}]}>
      <Text style={styles.title}>Find a Debate</Text>
      <Text style={styles.sub}>Get matched with someone who thinks differently</Text>

      <View style={styles.orbArea}>
        <Animated.View style={[styles.orbOuter, {transform: [{scale: pulse}]}]}>
          <View style={styles.orbInner}>
            <Text style={styles.orbIcon}>{searching ? '⚡' : '🎯'}</Text>
          </View>
        </Animated.View>
        {searching && (
          <>
            <Text style={styles.stageText}>{STAGES[stage]}</Text>
            <Text style={styles.timer}>{mins}:{secs}</Text>
          </>
        )}
      </View>

      {!searching ? (
        <ArgueButton label="Start Debating" onPress={startSearch} style={styles.actionBtn} />
      ) : (
        <ArgueButton label="Cancel" onPress={cancelSearch} variant="ghost" style={styles.actionBtn} />
      )}

      <GlassCard style={styles.infoCard}>
        <Text style={styles.infoTitle}>How it works</Text>
        {[
          ['🔍', 'Get matched with a random user'],
          ['🎭', 'Assigned opposing debate sides'],
          ['⏱️', '5-minute structured argument'],
          ['🏆', 'Community votes on the winner'],
        ].map(([icon, text]) => (
          <View key={text} style={styles.infoRow}>
            <Text style={styles.infoIcon}>{icon}</Text>
            <Text style={styles.infoText}>{text}</Text>
          </View>
        ))}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: colors.bg,
    paddingHorizontal: spacing.md, paddingTop: spacing.xl,
  },
  title: {fontSize: font.xl, fontWeight: '800', color: colors.text, textAlign: 'center'},
  sub: {fontSize: font.sm, color: colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: spacing.xl},
  orbArea: {alignItems: 'center', marginBottom: spacing.xl},
  orbOuter: {
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: colors.purpleDim, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  orbInner: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center',
  },
  orbIcon: {fontSize: 40},
  stageText: {fontSize: font.base, color: colors.text, fontWeight: '600', marginBottom: 4},
  timer: {fontSize: font.md, color: colors.purple, fontWeight: '700', fontVariant: ['tabular-nums']},
  actionBtn: {marginBottom: spacing.lg},
  infoCard: {marginTop: 'auto'},
  infoTitle: {fontSize: font.base, fontWeight: '700', color: colors.text, marginBottom: spacing.sm},
  infoRow: {flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs},
  infoIcon: {fontSize: 18, marginRight: spacing.sm},
  infoText: {fontSize: font.sm, color: colors.textMuted, flex: 1},
});

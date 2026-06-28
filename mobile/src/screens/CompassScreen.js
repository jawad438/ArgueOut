import React, {useState, useRef, useEffect} from 'react';
import {
  View, Text, PanResponder, StyleSheet, Dimensions, Alert,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, spacing, font, radii} from '../theme';
import ArgueButton from '../components/ArgueButton';
import GlassCard from '../components/GlassCard';
import {updateCompass, getMe} from '../services/api';

const {width} = Dimensions.get('window');
const GRID = Math.min(width - spacing.md * 2, 320);
const CENTER = GRID / 2;

export default function CompassScreen() {
  const insets = useSafeAreaInsets();
  const [pos, setPos] = useState({x: 0, y: 0});
  const [saved, setSaved] = useState({x: 0, y: 0});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const dragOffset = useRef({x: 0, y: 0});

  useEffect(() => {
    getMe()
      .then(profile => {
        const px = profile.politicalX ?? 0;
        const py = profile.politicalY ?? 0;
        setPos({x: px, y: py});
        setSaved({x: px, y: py});
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  function clamp(v) { return Math.max(-1, Math.min(1, v)); }

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: evt => {
      const {locationX, locationY} = evt.nativeEvent;
      dragOffset.current = {
        x: (locationX - CENTER) / CENTER,
        y: (locationY - CENTER) / CENTER,
      };
    },
    onPanResponderMove: (_, gs) => {
      const baseX = (gs.moveX - (width - GRID) / 2 - CENTER) / CENTER;
      const baseY = (gs.moveY - 100 - CENTER) / CENTER;
      setPos({x: clamp(baseX), y: clamp(baseY)});
    },
  });

  async function handleSave() {
    try {
      setSaving(true);
      await updateCompass(pos.x, pos.y);
      setSaved(pos);
      Alert.alert('Saved', 'Your political compass has been updated.');
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  const dotX = pos.x * CENTER + CENTER;
  const dotY = pos.y * CENTER + CENTER;
  const isDirty = pos.x !== saved.x || pos.y !== saved.y;

  function quadrantLabel(x, y) {
    if (x < -0.1 && y < -0.1) return 'Libertarian Left';
    if (x > 0.1 && y < -0.1)  return 'Libertarian Right';
    if (x < -0.1 && y > 0.1)  return 'Authoritarian Left';
    if (x > 0.1 && y > 0.1)   return 'Authoritarian Right';
    return 'Centrist';
  }

  return (
    <View style={[styles.root, {paddingBottom: insets.bottom + spacing.md}]}>
      <Text style={styles.title}>Political Compass</Text>
      <Text style={styles.sub}>Drag the dot to set your political position</Text>

      <View style={styles.gridWrapper} {...panResponder.panHandlers}>
        {/* Quadrant backgrounds */}
        <View style={styles.quadTopLeft} />
        <View style={styles.quadTopRight} />
        <View style={styles.quadBotLeft} />
        <View style={styles.quadBotRight} />

        {/* Axis lines */}
        <View style={styles.axisH} />
        <View style={styles.axisV} />

        {/* Axis labels */}
        <Text style={[styles.axisLabel, styles.left]}>Left</Text>
        <Text style={[styles.axisLabel, styles.right]}>Right</Text>
        <Text style={[styles.axisLabel, styles.top]}>Auth</Text>
        <Text style={[styles.axisLabel, styles.bottom]}>Lib</Text>

        {/* Draggable dot */}
        {loaded && (
          <View style={[styles.dot, {left: dotX - 14, top: dotY - 14}]} />
        )}
      </View>

      <GlassCard style={styles.posCard}>
        <Text style={styles.posLabel}>Your position</Text>
        <Text style={styles.posValue}>{quadrantLabel(pos.x, pos.y)}</Text>
        <Text style={styles.posCoords}>
          X: {pos.x.toFixed(2)}  Y: {pos.y.toFixed(2)}
        </Text>
      </GlassCard>

      {isDirty && (
        <ArgueButton label="Save Position" onPress={handleSave} loading={saving} style={styles.saveBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: colors.bg,
    paddingHorizontal: spacing.md, paddingTop: spacing.xl,
    alignItems: 'center',
  },
  title: {fontSize: font.xl, fontWeight: '800', color: colors.text},
  sub: {fontSize: font.sm, color: colors.textMuted, marginTop: 6, marginBottom: spacing.lg, textAlign: 'center'},
  gridWrapper: {
    width: GRID, height: GRID,
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', position: 'relative',
    marginBottom: spacing.lg,
  },
  quadTopLeft:  {position:'absolute', top:0, left:0, width:CENTER, height:CENTER, backgroundColor:'rgba(250,100,100,0.08)'},
  quadTopRight: {position:'absolute', top:0, right:0, width:CENTER, height:CENTER, backgroundColor:'rgba(100,100,250,0.08)'},
  quadBotLeft:  {position:'absolute', bottom:0, left:0, width:CENTER, height:CENTER, backgroundColor:'rgba(100,250,100,0.08)'},
  quadBotRight: {position:'absolute', bottom:0, right:0, width:CENTER, height:CENTER, backgroundColor:'rgba(250,250,100,0.08)'},
  axisH: {position:'absolute', top:CENTER-0.5, left:0, right:0, height:1, backgroundColor:colors.border},
  axisV: {position:'absolute', left:CENTER-0.5, top:0, bottom:0, width:1, backgroundColor:colors.border},
  axisLabel: {position:'absolute', fontSize:10, color:colors.textMuted, fontWeight:'600'},
  left:   {left:8, top:CENTER-8},
  right:  {right:8, top:CENTER-8},
  top:    {top:6, left:CENTER-12},
  bottom: {bottom:6, left:CENTER-10},
  dot: {
    position:'absolute', width:28, height:28, borderRadius:14,
    backgroundColor:colors.purple, borderWidth:3, borderColor:'#fff',
    shadowColor:colors.purple, shadowRadius:8, shadowOpacity:0.8,
  },
  posCard: {width:'100%', alignItems:'center', marginBottom:spacing.md},
  posLabel: {fontSize:font.xs, color:colors.textMuted, marginBottom:4},
  posValue: {fontSize:font.md, fontWeight:'700', color:colors.text},
  posCoords: {fontSize:font.xs, color:colors.textMuted, marginTop:4, fontVariant:['tabular-nums']},
  saveBtn: {width:'100%'},
});

import React, {useState, useEffect} from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import {colors, spacing, font, radii} from '../theme';

export default function NotificationsScreen({navigation}) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = auth().currentUser?.uid;
    if (!uid) { setLoading(false); return; }

    const unsub = firestore()
      .collection('notifications')
      .doc(uid)
      .collection('items')
      .orderBy('createdAt', 'desc')
      .limit(40)
      .onSnapshot(
        snap => {
          setItems(snap.docs.map(d => ({id: d.id, ...d.data()})));
          setLoading(false);
        },
        () => setLoading(false),
      );

    return unsub;
  }, []);

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={{width: 44}} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.purple} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyTitle}>All clear</Text>
          <Text style={styles.emptySub}>You have no notifications yet</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          contentContainerStyle={{paddingBottom: insets.bottom + spacing.lg}}
          renderItem={({item}) => <NotifCard item={item} />}
        />
      )}
    </View>
  );
}

function NotifCard({item}) {
  const time = item.createdAt?.toDate?.() ?? null;
  const timeStr = time
    ? time.toLocaleDateString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})
    : '';

  return (
    <View style={styles.card}>
      <View style={styles.cardDot} />
      <View style={styles.cardBody}>
        <Text style={styles.cardMsg}>{item.message || item.text || 'New notification'}</Text>
        {timeStr ? <Text style={styles.cardTime}>{timeStr}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  backIcon: {fontSize: 24, color: colors.text},
  title: {fontSize: font.md, fontWeight: '700', color: colors.text},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm},
  emptyIcon: {fontSize: 48},
  emptyTitle: {fontSize: font.md, fontWeight: '700', color: colors.text},
  emptySub: {fontSize: font.sm, color: colors.textMuted},
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  cardDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.purple, marginTop: 6, flexShrink: 0,
  },
  cardBody: {flex: 1},
  cardMsg: {fontSize: font.sm, color: colors.text, lineHeight: 20},
  cardTime: {fontSize: font.xs, color: colors.textMuted, marginTop: 4},
});

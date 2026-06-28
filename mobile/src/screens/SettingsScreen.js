import React, {useState, useEffect} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, Share, ActivityIndicator,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import {colors, spacing, font, radii} from '../theme';
import {getMe} from '../services/api';
import {connectAndAuthenticate} from '../services/socket';

export default function SettingsScreen({navigation}) {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    getMe().then(setProfile).catch(() => {});
  }, []);

  async function generateInviteLink() {
    try {
      setInviteLoading(true);
      const s = await connectAndAuthenticate();
      s.emit('generate-invite', {expiryMs: 24 * 60 * 60 * 1000});
      s.once('invite-generated', async ({url}) => {
        setInviteLoading(false);
        const link = `https://argueout.onrender.com${url}`;
        await Share.share({message: `Join me on ArgueOut for a debate!\n${link}`});
      });
    } catch (e) {
      setInviteLoading(false);
      Alert.alert('Error', e.message);
    }
  }

  async function requestDeletion() {
    Alert.alert(
      'Delete Account',
      'This will submit a deletion request to the admin team. Your account will be reviewed and deleted within 48 hours. Are you sure?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Request Deletion',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleteLoading(true);
              const token = await auth().currentUser.getIdToken();
              const res = await fetch('https://argueout.onrender.com/api/request-deletion', {
                method: 'POST',
                headers: {'Authorization': `Bearer ${token}`},
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error);
              Alert.alert('Submitted', 'Your deletion request has been received. You will be notified.');
            } catch (e) {
              Alert.alert('Error', e.message);
            } finally {
              setDeleteLoading(false);
            }
          },
        },
      ],
    );
  }

  const isAdmin = profile?.isAdmin;

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{width: 44}} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{paddingBottom: insets.bottom + spacing.xl}}>

        {/* Profile quick card */}
        <TouchableOpacity
          style={styles.profileCard}
          onPress={() => navigation.navigate('Profile')}
          activeOpacity={0.8}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>
              {(profile?.name || profile?.username || '?')[0]?.toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{profile?.name || '…'}</Text>
            <Text style={styles.profileUsername}>@{profile?.username || '…'}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <Section label="ACCOUNT">
          <SettingRow
            icon="👤"
            label="Edit Profile"
            onPress={() => navigation.navigate('Profile')}
          />
          <SettingRow
            icon="🔔"
            label="Notifications"
            onPress={() => navigation.navigate('Notifications')}
          />
          <SettingRow
            icon="🧭"
            label="Political Compass"
            onPress={() => navigation.navigate('Compass')}
          />
        </Section>

        <Section label="SHARE">
          <SettingRow
            icon="🔗"
            label="Generate Invite Link"
            onPress={generateInviteLink}
            loading={inviteLoading}
            sublabel="Share a 24-hour invite link"
          />
        </Section>

        {isAdmin && (
          <Section label="ADMIN">
            <SettingRow
              icon="🛡️"
              label="Admin Panel"
              onPress={() => navigation.navigate('AdminPanel')}
              accent
            />
          </Section>
        )}

        <Section label="DANGER ZONE">
          <SettingRow
            icon="🗑️"
            label="Request Account Deletion"
            onPress={requestDeletion}
            loading={deleteLoading}
            danger
            sublabel="Reviewed and deleted within 48 hrs"
          />
        </Section>

        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={() => auth().signOut()}
          activeOpacity={0.8}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Section({label, children}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function SettingRow({icon, label, sublabel, onPress, loading, danger, accent}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, danger && styles.rowDanger, accent && styles.rowAccent]}>
          {label}
        </Text>
        {sublabel ? <Text style={styles.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {loading
        ? <ActivityIndicator size="small" color={colors.textMuted} />
        : <Text style={styles.chevron}>›</Text>}
    </TouchableOpacity>
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
  scroll: {flex: 1},
  profileCard: {
    flexDirection: 'row', alignItems: 'center',
    margin: spacing.md,
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: spacing.md, gap: spacing.md,
  },
  profileAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center',
  },
  profileAvatarText: {fontSize: font.md, fontWeight: '800', color: '#fff'},
  profileInfo: {flex: 1},
  profileName: {fontSize: font.base, fontWeight: '700', color: colors.text},
  profileUsername: {fontSize: font.sm, color: colors.textMuted, marginTop: 2},
  chevron: {fontSize: 22, color: colors.textMuted},
  section: {marginHorizontal: spacing.md, marginBottom: spacing.md},
  sectionLabel: {
    fontSize: font.xs, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 0.8, marginBottom: spacing.xs, paddingLeft: 4,
  },
  sectionCard: {
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  rowIcon: {fontSize: 20, width: 28, textAlign: 'center'},
  rowText: {flex: 1},
  rowLabel: {fontSize: font.base, color: colors.text},
  rowDanger: {color: colors.error},
  rowAccent: {color: colors.purple},
  rowSublabel: {fontSize: font.xs, color: colors.textMuted, marginTop: 2},
  signOutBtn: {
    margin: spacing.md, marginTop: spacing.xs,
    paddingVertical: 14, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center',
  },
  signOutText: {fontSize: font.base, color: colors.textMuted, fontWeight: '600'},
});

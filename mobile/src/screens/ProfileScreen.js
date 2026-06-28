import React, {useState, useEffect} from 'react';
import {
  View, Text, TextInput, ScrollView, StyleSheet,
  TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import {colors, spacing, font, radii} from '../theme';
import GlassCard from '../components/GlassCard';
import ArgueButton from '../components/ArgueButton';
import {getMe, updateProfileField} from '../services/api';

export default function ProfileScreen({navigation}) {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      getMe().then(setProfile).catch(() => {});
    });
    return unsub;
  }, [navigation]);

  async function saveField(field) {
    try {
      setSaving(true);
      await updateProfileField(field, editValue.trim());
      setProfile(p => ({...p, [field]: editValue.trim()}));
      setEditing(null);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.purple} />
      </View>
    );
  }

  const editableFields = [
    {key: 'name',     label: 'Name'},
    {key: 'username', label: 'Username'},
    {key: 'bio',      label: 'Bio', multiline: true},
  ];

  const readonlyFields = [
    {key: 'country',  label: 'Country'},
    {key: 'age',      label: 'Age'},
    {key: 'gender',   label: 'Gender'},
    {key: 'religion', label: 'Religion'},
  ];

  return (
    <ScrollView
      style={[styles.root, {paddingTop: insets.top}]}
      contentContainerStyle={{paddingBottom: insets.bottom + spacing.xl}}>

      {/* Avatar / name block */}
      <View style={styles.hero}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile.name || profile.username || '?')[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.displayName}>{profile.name}</Text>
        <Text style={styles.username}>@{profile.username}</Text>
      </View>

      {/* Editable fields */}
      <Text style={styles.sectionLabel}>EDIT PROFILE</Text>
      {editableFields.map(f => (
        <GlassCard key={f.key} style={styles.fieldCard}>
          <View style={styles.fieldTop}>
            <Text style={styles.fieldLabel}>{f.label}</Text>
            {editing !== f.key && (
              <TouchableOpacity onPress={() => {setEditing(f.key); setEditValue(profile[f.key] ?? '');}}>
                <Text style={styles.editLink}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>
          {editing === f.key ? (
            <>
              <TextInput
                style={[styles.input, f.multiline && {height: 80, textAlignVertical: 'top'}]}
                value={editValue}
                onChangeText={setEditValue}
                multiline={f.multiline}
                autoFocus
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.editRow}>
                <TouchableOpacity onPress={() => setEditing(null)} style={styles.cancelBtn}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <ArgueButton label="Save" onPress={() => saveField(f.key)} loading={saving} style={styles.saveBtn} />
              </View>
            </>
          ) : (
            <Text style={styles.fieldValue}>{profile[f.key] || <Text style={styles.placeholder}>Not set</Text>}</Text>
          )}
        </GlassCard>
      ))}

      {/* Read-only info */}
      <Text style={[styles.sectionLabel, {marginTop: spacing.md}]}>ACCOUNT INFO</Text>
      <GlassCard style={styles.infoCard}>
        {readonlyFields.map((f, i) => (
          <View key={f.key} style={[styles.infoRow, i < readonlyFields.length - 1 && styles.infoRowBorder]}>
            <Text style={styles.infoLabel}>{f.label}</Text>
            <Text style={styles.infoValue}>{profile[f.key] || '—'}</Text>
          </View>
        ))}
      </GlassCard>

      {/* Settings link */}
      <TouchableOpacity
        style={styles.settingsLink}
        onPress={() => navigation.navigate('Settings')}
        activeOpacity={0.8}>
        <Text style={styles.settingsLinkText}>⚙️  Account Settings</Text>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  center: {flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center'},
  hero: {alignItems: 'center', paddingVertical: spacing.xl},
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {fontSize: font.xl, fontWeight: '800', color: '#fff'},
  displayName: {fontSize: font.lg, fontWeight: '700', color: colors.text},
  username: {fontSize: font.sm, color: colors.textMuted, marginTop: 4},
  sectionLabel: {
    fontSize: font.xs, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 0.8, paddingHorizontal: spacing.md, marginBottom: spacing.xs,
  },
  fieldCard: {marginHorizontal: spacing.md, marginBottom: spacing.sm},
  fieldTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6},
  fieldLabel: {fontSize: font.xs, color: colors.textMuted, fontWeight: '600'},
  editLink: {fontSize: font.sm, color: colors.purple, fontWeight: '600'},
  fieldValue: {fontSize: font.base, color: colors.text},
  placeholder: {color: colors.textMuted},
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: spacing.sm,
    paddingVertical: 10, color: colors.text, fontSize: font.base, marginBottom: spacing.sm,
  },
  editRow: {flexDirection: 'row', gap: spacing.sm},
  cancelBtn: {flex: 1, height: 44, alignItems: 'center', justifyContent: 'center'},
  cancelText: {color: colors.textMuted, fontWeight: '600'},
  saveBtn: {flex: 1, height: 44},
  infoCard: {marginHorizontal: spacing.md, padding: 0},
  infoRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md},
  infoRowBorder: {borderBottomWidth: 1, borderBottomColor: colors.border},
  infoLabel: {fontSize: font.sm, color: colors.textMuted},
  infoValue: {fontSize: font.sm, color: colors.text, fontWeight: '500'},
  settingsLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: spacing.md, marginTop: spacing.md,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  settingsLinkText: {fontSize: font.base, color: colors.text, fontWeight: '500'},
  chevron: {fontSize: 20, color: colors.textMuted},
});

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

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMe().then(setProfile).catch(() => {});
  }, []);

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

  function startEdit(field) {
    setEditing(field);
    setEditValue(profile?.[field] ?? '');
  }

  function cancelEdit() {
    setEditing(null);
    setEditValue('');
  }

  if (!profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.purple} />
      </View>
    );
  }

  const fields = [
    {key: 'name',    label: 'Name',     editable: true},
    {key: 'username', label: 'Username', editable: true},
    {key: 'bio',     label: 'Bio',      editable: true, multiline: true},
    {key: 'country', label: 'Country',  editable: false},
    {key: 'age',     label: 'Age',      editable: false},
    {key: 'gender',  label: 'Gender',   editable: false},
    {key: 'religion',label: 'Religion', editable: false},
  ];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.scroll, {paddingBottom: insets.bottom + spacing.lg}]}>

      {/* Avatar / header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(profile.name || profile.username || '?')[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.displayName}>{profile.name}</Text>
        <Text style={styles.username}>@{profile.username}</Text>
      </View>

      {/* Editable fields */}
      {fields.map(f => (
        <GlassCard key={f.key} style={styles.fieldCard}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>{f.label}</Text>
            {f.editable && editing !== f.key && (
              <TouchableOpacity onPress={() => startEdit(f.key)}>
                <Text style={styles.editBtn}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {editing === f.key ? (
            <>
              <TextInput
                style={[styles.input, f.multiline && {height: 80}]}
                value={editValue}
                onChangeText={setEditValue}
                multiline={f.multiline}
                autoFocus
                placeholderTextColor={colors.textMuted}
                color={colors.text}
              />
              <View style={styles.editActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={cancelEdit}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <ArgueButton
                  label="Save"
                  onPress={() => saveField(f.key)}
                  loading={saving}
                  style={styles.saveBtn}
                />
              </View>
            </>
          ) : (
            <Text style={styles.fieldValue}>
              {profile[f.key] || <Text style={styles.placeholder}>Not set</Text>}
            </Text>
          )}
        </GlassCard>
      ))}

      {/* Sign out */}
      <ArgueButton
        label="Sign Out"
        variant="ghost"
        onPress={() => auth().signOut()}
        style={styles.signOutBtn}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  scroll: {padding: spacing.md, paddingTop: spacing.lg},
  center: {flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center'},
  header: {alignItems: 'center', marginBottom: spacing.lg},
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {fontSize: font.xl, fontWeight: '800', color: '#fff'},
  displayName: {fontSize: font.lg, fontWeight: '700', color: colors.text},
  username: {fontSize: font.sm, color: colors.textMuted, marginTop: 4},
  fieldCard: {marginBottom: spacing.sm},
  fieldHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6},
  fieldLabel: {fontSize: font.xs, color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5},
  editBtn: {fontSize: font.sm, color: colors.purple, fontWeight: '600'},
  fieldValue: {fontSize: font.base, color: colors.text},
  placeholder: {color: colors.textMuted},
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: spacing.sm,
    paddingVertical: 10, color: colors.text, fontSize: font.base, marginBottom: spacing.sm,
  },
  editActions: {flexDirection: 'row', gap: spacing.sm},
  cancelBtn: {flex: 1, height: 44, alignItems: 'center', justifyContent: 'center'},
  cancelText: {color: colors.textMuted, fontWeight: '600'},
  saveBtn: {flex: 1, height: 44},
  signOutBtn: {marginTop: spacing.md},
});

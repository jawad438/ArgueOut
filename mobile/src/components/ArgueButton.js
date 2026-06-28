import React from 'react';
import {TouchableOpacity, Text, ActivityIndicator, StyleSheet} from 'react-native';
import {colors, radii, font, spacing} from '../theme';

export default function ArgueButton({label, onPress, loading, variant = 'primary', style}) {
  const isPrimary = variant === 'primary';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.8}
      style={[styles.btn, isPrimary ? styles.primary : styles.ghost, style]}>
      {loading
        ? <ActivityIndicator color={isPrimary ? '#fff' : colors.purple} size="small" />
        : <Text style={[styles.label, !isPrimary && styles.labelGhost]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primary: {
    backgroundColor: colors.purple,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.purple,
  },
  label: {
    color: '#fff',
    fontSize: font.base,
    fontWeight: '600',
  },
  labelGhost: {
    color: colors.purple,
  },
});

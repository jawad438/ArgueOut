import React from 'react';
import {View, StyleSheet} from 'react-native';
import {colors, radii, spacing} from '../theme';

export default function GlassCard({style, children}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
});

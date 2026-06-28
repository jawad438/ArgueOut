import React, {useRef, useEffect, useState} from 'react';
import {View, Text, ActivityIndicator, StyleSheet, TouchableOpacity, BackHandler} from 'react-native';
import {WebView} from 'react-native-webview';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, spacing, font} from '../theme';
import {getSessionToken} from '../services/api';

export default function DebateScreen({route, navigation}) {
  const {debateId} = route.params ?? {};
  const insets = useSafeAreaInsets();
  const wvRef = useRef(null);
  const [customToken, setCustomToken] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSessionToken()
      .then(setCustomToken)
      .catch(e => setError(e.message));
  }, []);

  // Block hardware back during debate
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const debateUrl = `https://argueout.onrender.com/debate${debateId ? `?id=${debateId}` : ''}`;

  // Inject auth token before page loads so mobile-bridge.js can pick it up
  const injectedJS = customToken
    ? `window.__MOBILE_CUSTOM_TOKEN = ${JSON.stringify(customToken)}; true;`
    : 'true;';

  if (error) {
    return (
      <View style={[styles.center, {paddingTop: insets.top}]}>
        <Text style={styles.errText}>Failed to start debate</Text>
        <Text style={styles.errSub}>{error}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!customToken) {
    return (
      <View style={[styles.center, {paddingTop: insets.top}]}>
        <ActivityIndicator size="large" color={colors.purple} />
        <Text style={styles.loadText}>Joining debate…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, {paddingTop: insets.top}]}>
      <WebView
        ref={wvRef}
        source={{uri: debateUrl}}
        injectedJavaScriptBeforeContentLoaded={injectedJS}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        onMessage={event => {
          try {
            const msg = JSON.parse(event.nativeEvent.data);
            if (msg.type === 'debateEnded') navigation.goBack();
          } catch (_) {}
        }}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  webview: {flex: 1, backgroundColor: colors.bg},
  center: {flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg},
  errText: {fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: spacing.xs},
  errSub: {fontSize: font.sm, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg},
  backBtn: {paddingHorizontal: 24, paddingVertical: 12, backgroundColor: colors.purple, borderRadius: 8},
  backBtnText: {color: '#fff', fontWeight: '600'},
  loadText: {marginTop: spacing.md, color: colors.textMuted, fontSize: font.sm},
});

import React, {useState} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import auth from '@react-native-firebase/auth';
import {colors, spacing, font, radii} from '../theme';
import ArgueButton from '../components/ArgueButton';
import {lookupEmail, registerUser} from '../services/api';

const COUNTRIES = ['Afghanistan','Albania','Algeria','Argentina','Australia','Austria','Bangladesh',
  'Belgium','Brazil','Canada','Chile','China','Colombia','Egypt','Ethiopia','France','Germany',
  'Ghana','Greece','India','Indonesia','Iran','Iraq','Ireland','Italy','Japan','Kenya','Malaysia',
  'Mexico','Morocco','Netherlands','Nigeria','Norway','Pakistan','Peru','Philippines','Poland',
  'Portugal','Romania','Russia','Saudi Arabia','South Africa','South Korea','Spain','Sweden',
  'Switzerland','Thailand','Turkey','Uganda','Ukraine','United Kingdom','United States','Vietnam'];

export default function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);

  // login fields
  const [loginId, setLoginId] = useState('');
  const [loginPw, setLoginPw] = useState('');

  // register fields
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPw, setRegPw] = useState('');
  const [regAge, setRegAge] = useState('');
  const [regGender, setRegGender] = useState('prefer_not_to_say');
  const [regReligion, setRegReligion] = useState('prefer_not_to_say');
  const [regCountry, setRegCountry] = useState('');

  async function handleLogin() {
    if (!loginId.trim() || !loginPw) return Alert.alert('Error', 'Fill in all fields');
    try {
      setLoading(true);
      const email = await lookupEmail(loginId.trim().toLowerCase());
      await auth().signInWithEmailAndPassword(email, loginPw);
    } catch (e) {
      Alert.alert('Login failed', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    if (!regName || !regUsername || !regEmail || !regPw || !regAge)
      return Alert.alert('Error', 'Please fill in all required fields');
    if (parseInt(regAge) < 13) return Alert.alert('Error', 'You must be at least 13');
    try {
      setLoading(true);
      const {customToken} = await registerUser({
        name: regName, username: regUsername, email: regEmail,
        password: regPw, age: regAge, gender: regGender,
        religion: regReligion, country: regCountry,
      });
      await auth().signInWithCustomToken(customToken);
    } catch (e) {
      Alert.alert('Registration failed', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled">

        <Text style={styles.brand}>ArgueOut</Text>
        <Text style={styles.sub}>Political debates, reimagined</Text>

        <View style={styles.toggleRow}>
          {['login', 'register'].map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.toggleBtn, mode === m && styles.toggleActive]}
              onPress={() => setMode(m)}>
              <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>
                {m === 'login' ? 'Sign In' : 'Register'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {mode === 'login' ? (
          <View style={styles.card}>
            <Text style={styles.label}>Username or Email</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter username or email"
              placeholderTextColor={colors.textMuted}
              value={loginId}
              onChangeText={setLoginId}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter password"
              placeholderTextColor={colors.textMuted}
              value={loginPw}
              onChangeText={setLoginPw}
              secureTextEntry
            />
            <ArgueButton label="Sign In" onPress={handleLogin} loading={loading} style={styles.mt16} />
          </View>
        ) : (
          <View style={styles.card}>
            <Field label="Full Name *" value={regName} onChange={setRegName} placeholder="Your real name" />
            <Field label="Username *" value={regUsername} onChange={setRegUsername}
              placeholder="lowercase, 3–20 chars" autoCapitalize="none" />
            <Field label="Email *" value={regEmail} onChange={setRegEmail}
              placeholder="your@email.com" keyboardType="email-address" autoCapitalize="none" />
            <Field label="Password *" value={regPw} onChange={setRegPw}
              placeholder="Min 8 characters" secureTextEntry />
            <Field label="Age *" value={regAge} onChange={setRegAge}
              placeholder="Must be 13+" keyboardType="number-pad" />

            <Text style={styles.label}>Gender</Text>
            <SelectRow
              options={['male','female','prefer_not_to_say']}
              labels={['Male','Female','Prefer not to say']}
              value={regGender}
              onChange={setRegGender}
            />

            <Text style={styles.label}>Religion</Text>
            <SelectRow
              options={['christian','muslim','jewish','hindu','buddhist','atheist','agnostic','other','prefer_not_to_say']}
              labels={['Christian','Muslim','Jewish','Hindu','Buddhist','Atheist','Agnostic','Other','Prefer not to say']}
              value={regReligion}
              onChange={setRegReligion}
            />

            <Text style={styles.label}>Country</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.countryScroll}>
              {COUNTRIES.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[styles.chip, regCountry === c && styles.chipActive]}
                  onPress={() => setRegCountry(c)}>
                  <Text style={[styles.chipText, regCountry === c && styles.chipTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <ArgueButton label="Create Account" onPress={handleRegister} loading={loading} style={styles.mt16} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({label, value, onChange, placeholder, secureTextEntry, keyboardType, autoCapitalize}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType || 'default'}
        autoCapitalize={autoCapitalize || 'sentences'}
        autoCorrect={false}
      />
    </>
  );
}

function SelectRow({options, labels, value, onChange}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
      {options.map((o, i) => (
        <TouchableOpacity
          key={o}
          style={[styles.chip, value === o && styles.chipActive]}
          onPress={() => onChange(o)}>
          <Text style={[styles.chipText, value === o && styles.chipTextActive]}>{labels[i]}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  scroll: {flexGrow: 1, padding: spacing.md, paddingTop: spacing.xxl},
  brand: {
    fontSize: font.xxl, fontWeight: '800', color: colors.purple,
    textAlign: 'center', letterSpacing: -0.5,
  },
  sub: {
    fontSize: font.sm, color: colors.textMuted,
    textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.xl,
  },
  toggleRow: {
    flexDirection: 'row', borderRadius: radii.md,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.md, overflow: 'hidden',
  },
  toggleBtn: {flex: 1, paddingVertical: 12, alignItems: 'center'},
  toggleActive: {backgroundColor: colors.purple},
  toggleText: {color: colors.textMuted, fontWeight: '600', fontSize: font.sm},
  toggleTextActive: {color: '#fff'},
  card: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.lg, padding: spacing.md,
  },
  label: {color: colors.textMuted, fontSize: font.sm, marginTop: spacing.md, marginBottom: 6},
  input: {
    height: 52, borderRadius: radii.md, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md,
    color: colors.text, fontSize: font.base,
  },
  mt16: {marginTop: spacing.md},
  chipScroll: {marginBottom: 4},
  countryScroll: {marginBottom: 4},
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.full,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgCard, marginRight: spacing.xs,
  },
  chipActive: {backgroundColor: colors.purple, borderColor: colors.purple},
  chipText: {color: colors.textMuted, fontSize: font.xs},
  chipTextActive: {color: '#fff'},
});

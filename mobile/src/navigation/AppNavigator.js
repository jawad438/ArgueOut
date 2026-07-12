import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import LobbyScreen       from '../screens/LobbyScreen';
import DebateScreen      from '../screens/DebateScreen';
import CompassScreen     from '../screens/CompassScreen';
import ProfileScreen     from '../screens/ProfileScreen';
import SettingsScreen    from '../screens/SettingsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import {colors, font, spacing, radii} from '../theme';

const Tab   = createBottomTabNavigator();
const Root  = createNativeStackNavigator();

function TabNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0d0d1f',
          borderTopColor: colors.border,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
        },
        tabBarShowLabel: false,
      }}>
      <Tab.Screen
        name="LobbyTab"
        component={LobbyScreen}
        options={{
          tabBarIcon: ({focused}) => (
            <TabIcon icon="⚡" label="Lobby" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({focused}) => (
            <TabIcon icon="👤" label="Profile" focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function TabIcon({icon, label, focused}) {
  return (
    <View style={styles.tabItem}>
      <Text style={styles.tabIcon}>{icon}</Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

export default function AppNavigator() {
  return (
    <Root.Navigator screenOptions={{headerShown: false, presentation: 'card'}}>
      <Root.Screen name="Main" component={TabNavigator} />
      <Root.Screen name="Debate"        component={DebateScreen}        options={{gestureEnabled: false}} />
      <Root.Screen name="Settings"      component={SettingsScreen} />
      <Root.Screen name="Notifications" component={NotificationsScreen} />
      <Root.Screen name="Compass"       component={CompassScreen} />
      {/* Admin panel stub — navigate to website admin via WebView */}
      <Root.Screen name="AdminPanel"    component={AdminPanelScreen} />
    </Root.Navigator>
  );
}

// Thin WebView wrapper for the admin panel (admin accounts only)
import {WebView} from 'react-native-webview';
import {useSafeAreaInsets as useSAI} from 'react-native-safe-area-context';
import {getSessionToken} from '../services/api';
import {useState, useEffect} from 'react';
import {ActivityIndicator} from 'react-native';

function AdminPanelScreen({navigation}) {
  const insets = useSAI();
  const [token, setToken] = useState(null);
  useEffect(() => {
    getSessionToken().then(setToken).catch(() => navigation.goBack());
  }, []);

  const js = token ? `window.__MOBILE_CUSTOM_TOKEN=${JSON.stringify(token)};true;` : 'true;';

  return (
    <View style={{flex:1, backgroundColor:colors.bg, paddingTop:insets.top}}>
      {!token
        ? <View style={{flex:1,alignItems:'center',justifyContent:'center'}}><ActivityIndicator color={colors.purple} size="large"/></View>
        : <WebView source={{uri:'https://argueout.onrender.com/admin'}} injectedJavaScriptBeforeContentLoaded={js} javaScriptEnabled domStorageEnabled style={{flex:1,backgroundColor:colors.bg}} />
      }
    </View>
  );
}

const styles = StyleSheet.create({
  tabItem: {alignItems: 'center', minWidth: 60, paddingHorizontal: spacing.xs},
  tabIcon: {fontSize: 24},
  tabLabel: {fontSize: 10, color: colors.textMuted, marginTop: 3, fontWeight: '500'},
  tabLabelActive: {color: colors.purple},
});

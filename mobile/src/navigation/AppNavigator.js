import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createStackNavigator} from '@react-navigation/stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import LobbyScreen from '../screens/LobbyScreen';
import DebateScreen from '../screens/DebateScreen';
import CompassScreen from '../screens/CompassScreen';
import ProfileScreen from '../screens/ProfileScreen';
import {colors, font, spacing, radii} from '../theme';

const Tab = createBottomTabNavigator();
const LobbyStack = createStackNavigator();

function LobbyStackNav() {
  return (
    <LobbyStack.Navigator screenOptions={{headerShown: false}}>
      <LobbyStack.Screen name="LobbyHome" component={LobbyScreen} />
      <LobbyStack.Screen name="Debate" component={DebateScreen} options={{gestureEnabled: false}} />
    </LobbyStack.Navigator>
  );
}

function TabIcon({focused, icon, label}) {
  return (
    <View style={[styles.tabItem, focused && styles.tabItemActive]}>
      <Text style={styles.tabIcon}>{icon}</Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

export default function AppNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0d0d1f',
          borderTopColor: colors.border,
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
        },
        tabBarShowLabel: false,
      }}>
      <Tab.Screen
        name="Lobby"
        component={LobbyStackNav}
        options={{
          tabBarIcon: ({focused}) => <TabIcon focused={focused} icon="⚡" label="Lobby" />,
        }}
      />
      <Tab.Screen
        name="Compass"
        component={CompassScreen}
        options={{
          tabBarIcon: ({focused}) => <TabIcon focused={focused} icon="🧭" label="Compass" />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({focused}) => <TabIcon focused={focused} icon="👤" label="Profile" />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabItem: {alignItems: 'center', minWidth: 56, paddingHorizontal: spacing.xs},
  tabItemActive: {},
  tabIcon: {fontSize: 22},
  tabLabel: {fontSize: 10, color: colors.textMuted, marginTop: 3, fontWeight: '500'},
  tabLabelActive: {color: colors.purple},
});

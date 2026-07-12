import React, {useEffect, useRef, useState} from 'react';
import {StatusBar} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import AppNavigator from './src/navigation/AppNavigator';
import AuthScreen from './src/screens/AuthScreen';
import {initPushNotifications, initNotificationOpenHandlers, screenForLink} from './src/services/notifications';

export default function App() {
  const [user, setUser] = useState(undefined);
  const navigationRef = useRef(null);

  useEffect(() => {
    return auth().onAuthStateChanged(u => setUser(u ?? null));
  }, []);

  useEffect(() => {
    if (user) initPushNotifications();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return initNotificationOpenHandlers(link => {
      navigationRef.current?.navigate(screenForLink(link));
    });
  }, [user]);

  if (user === undefined) return null;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#05050f" />
      <NavigationContainer ref={navigationRef}>
        {user ? <AppNavigator /> : <AuthScreen />}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

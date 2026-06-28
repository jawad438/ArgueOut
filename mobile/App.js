import React, {useEffect, useState} from 'react';
import {StatusBar} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import auth from '@react-native-firebase/auth';
import AppNavigator from './src/navigation/AppNavigator';
import AuthScreen from './src/screens/AuthScreen';

export default function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    return auth().onAuthStateChanged(u => setUser(u ?? null));
  }, []);

  if (user === undefined) return null;

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#05050f" />
      <NavigationContainer>
        {user ? <AppNavigator /> : <AuthScreen />}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

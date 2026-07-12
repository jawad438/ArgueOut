import {Platform, PermissionsAndroid} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import {registerPushToken} from './api';

// Requests notification permission (Android 13+ needs the runtime
// PermissionsAndroid prompt; below that, and on the Firebase Messaging
// permission API used for iOS/older Android, granting is implicit or handled
// by requestPermission()) and registers the resulting token with the server.
// Called once per app session after the user is signed in (see App.js).
export async function initPushNotifications() {
  try {
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
    } else {
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;
      if (!enabled) return;
    }

    const token = await messaging().getToken();
    if (token) await registerPushToken(token).catch(() => {});

    messaging().onTokenRefresh(newToken => {
      registerPushToken(newToken).catch(() => {});
    });
  } catch (e) {
    console.warn('[push] init failed:', e.message);
  }
}

// Foreground messages don't show a system notification by default on RN
// Firebase Messaging — surfacing them is left to whatever in-app toast/alert
// system a screen wants to use; screens can subscribe via this helper.
export function onForegroundMessage(handler) {
  return messaging().onMessage(handler);
}

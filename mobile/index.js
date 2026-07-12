import {AppRegistry} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import {name as appName} from './app.json';

// Must be registered outside any component and before AppRegistry — this is
// what lets a push wake the app to handle it while fully backgrounded/killed.
messaging().setBackgroundMessageHandler(async () => {});

AppRegistry.registerComponent(appName, () => App);

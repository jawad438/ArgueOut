// Firebase client SDK — initialized once, used across all pages

const firebaseConfig = {
  apiKey:            'AIzaSyBFhRtNAEIg_iXwNEHCe9-ppPTQWTcn6hs',
  authDomain:        'argueout.firebaseapp.com',
  projectId:         'argueout',
  storageBucket:     'argueout.firebasestorage.app',
  messagingSenderId: '666299079183',
  appId:             '1:666299079183:web:0af715ed65d25c9290e17a'
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth        = firebase.auth();
const firestoreDb = firebase.firestore();

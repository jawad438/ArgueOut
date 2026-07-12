package com.argueout.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

// Handles FCM messages natively (the WebView's JS only runs while the app is
// open/foregrounded, so it can't receive push while backgrounded or killed —
// this service is what makes notifications arrive either way). Builds its
// own system notification in onMessageReceived because Android only
// auto-displays a "notification" payload when the app is backgrounded; in
// the foreground this callback fires instead and nothing is shown unless we
// build it ourselves, so we do so unconditionally for consistent behavior.
//
// Token forwarding to the server happens separately, in MainActivity, which
// actively fetches the current token via FirebaseMessaging.getInstance()
// after each page load rather than relying on onNewToken here (that only
// fires on token rotation, not on every app open).
public class FCMService extends FirebaseMessagingService {

    private static final String CHANNEL_ID = "argueout_default";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);

        String title = "ArgueOut";
        String body = "";
        if (message.getNotification() != null) {
            if (message.getNotification().getTitle() != null) title = message.getNotification().getTitle();
            if (message.getNotification().getBody() != null) body = message.getNotification().getBody();
        } else {
            if (message.getData().containsKey("title")) title = message.getData().get("title");
            if (message.getData().containsKey("body")) body = message.getData().get("body");
        }

        showNotification(title, body);
    }

    private void showNotification(String title, String body) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
            if (channel == null) {
                channel = new NotificationChannel(CHANNEL_ID, "ArgueOut", NotificationManager.IMPORTANCE_HIGH);
                manager.createNotificationChannel(channel);
            }
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_HIGH);

        manager.notify((int) System.currentTimeMillis(), builder.build());
    }
}

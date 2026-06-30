package com.argueout.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final String APP_URL = "https://argueout.onrender.com/lobby";
    private static final int PERMISSION_REQUEST_CODE = 1;
    private static final int RC_SIGN_IN = 9001;

    private WebView webView;
    private PermissionRequest pendingPermissionRequest;
    private GoogleSignInClient googleSignInClient;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#8b5cf6"));
            getWindow().setNavigationBarColor(Color.parseColor("#05050f"));
        }

        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.webview);
        setupWebView();
        webView.loadUrl(APP_URL);
    }

    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setTextZoom(100);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        // Remove "; wv)" so Google OAuth page (redirect fallback) isn't rejected
        String ua = s.getUserAgentString();
        s.setUserAgentString(ua.replace("; wv)", ")"));

        webView.addJavascriptInterface(new AndroidAuth(), "AndroidAuth");
        webView.setWebViewClient(new WebViewClient());

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                pendingPermissionRequest = request;
                List<String> toRequest = new ArrayList<>();
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                            && ContextCompat.checkSelfPermission(MainActivity.this,
                                Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        toRequest.add(Manifest.permission.CAMERA);
                    }
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                            && ContextCompat.checkSelfPermission(MainActivity.this,
                                Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        toRequest.add(Manifest.permission.RECORD_AUDIO);
                    }
                }
                if (toRequest.isEmpty()) {
                    request.grant(request.getResources());
                } else {
                    ActivityCompat.requestPermissions(MainActivity.this,
                            toRequest.toArray(new String[0]), PERMISSION_REQUEST_CODE);
                }
            }
        });
    }

    // Called from JavaScript with the Firebase web OAuth client ID
    class AndroidAuth {
        @JavascriptInterface
        public void startGoogleSignIn(final String webClientId) {
            runOnUiThread(() -> {
                GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                        .requestIdToken(webClientId)
                        .requestEmail()
                        .build();
                googleSignInClient = GoogleSignIn.getClient(MainActivity.this, gso);
                // Always sign out first so the picker is shown every time
                googleSignInClient.signOut().addOnCompleteListener(task ->
                        startActivityForResult(googleSignInClient.getSignInIntent(), RC_SIGN_IN));
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != RC_SIGN_IN) return;

        Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            String idToken = account.getIdToken();
            if (idToken != null) {
                String js = "window.onAndroidGoogleToken && window.onAndroidGoogleToken("
                        + JSONObject.quote(idToken) + ")";
                webView.post(() -> webView.evaluateJavascript(js, null));
            } else {
                String js = "window.onAndroidGoogleError && window.onAndroidGoogleError(\"no_id_token\")";
                webView.post(() -> webView.evaluateJavascript(js, null));
            }
        } catch (ApiException e) {
            String reason = (e.getStatusCode() == 12501) ? "cancelled" : String.valueOf(e.getStatusCode());
            String js = "window.onAndroidGoogleError && window.onAndroidGoogleError("
                    + JSONObject.quote(reason) + ")";
            webView.post(() -> webView.evaluateJavascript(js, null));
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == PERMISSION_REQUEST_CODE && pendingPermissionRequest != null) {
            pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
            pendingPermissionRequest = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() { super.onPause(); webView.onPause(); }

    @Override
    protected void onResume() { super.onResume(); webView.onResume(); }
}

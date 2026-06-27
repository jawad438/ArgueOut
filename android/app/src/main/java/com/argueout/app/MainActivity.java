package com.argueout.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final String APP_URL = "https://argueout.onrender.com/lobby";
    private static final int PERMISSION_REQUEST_CODE = 1;

    private WebView webView;
    private PermissionRequest pendingPermissionRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Purple status/nav bars to match ArgueOut theme
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
        // Let the site control zoom via meta viewport
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);

        webView.setWebViewClient(new WebViewClient());

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                pendingPermissionRequest = request;

                // Map WebRTC resource requests to Android permissions
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
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }
}

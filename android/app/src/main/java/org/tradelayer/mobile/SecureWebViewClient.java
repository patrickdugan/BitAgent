package org.tradelayer.mobile;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.webkit.ClientCertRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.webkit.SafeBrowsingResponseCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import androidx.webkit.WebViewFeature;

final class SecureWebViewClient extends WebViewClientCompat {
    interface StatusSink {
        void update(String message);
    }

    private final Context context;
    private final NavigationPolicy policy;
    private final WebViewAssetLoader assetLoader;
    private final StatusSink statusSink;

    SecureWebViewClient(
        Context context,
        NavigationPolicy policy,
        @Nullable WebViewAssetLoader assetLoader,
        StatusSink statusSink
    ) {
        this.context = context;
        this.policy = policy;
        this.assetLoader = assetLoader;
        this.statusSink = statusSink;
    }

    @Nullable
    @Override
    public WebResourceResponse shouldInterceptRequest(@NonNull WebView view, @NonNull WebResourceRequest request) {
        return assetLoader == null ? null : assetLoader.shouldInterceptRequest(request.getUrl());
    }

    @Override
    public boolean shouldOverrideUrlLoading(@NonNull WebView view, @NonNull WebResourceRequest request) {
        return handleNavigation(request.getUrl().toString());
    }

    @SuppressWarnings("deprecation")
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return handleNavigation(url);
    }

    private boolean handleNavigation(String url) {
        NavigationPolicy.Decision decision = policy.decide(url);
        if (decision == NavigationPolicy.Decision.INTERNAL) return false;
        if (decision == NavigationPolicy.Decision.EXTERNAL_HTTPS) {
            try {
                context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                statusSink.update("Opened external HTTPS link in your browser.");
            } catch (ActivityNotFoundException error) {
                statusSink.update("No browser is available for that link.");
            }
            return true;
        }
        statusSink.update("Blocked navigation outside the approved app origins.");
        return true;
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        handler.cancel();
        statusSink.update("TLS verification failed. The page was not loaded.");
    }

    @Override
    public void onReceivedClientCertRequest(WebView view, ClientCertRequest request) {
        request.cancel();
        statusSink.update("Client-certificate access is not available in the mobile shell.");
    }

    @Override
    public void onSafeBrowsingHit(
        @NonNull WebView view,
        @NonNull WebResourceRequest request,
        int threatType,
        @NonNull SafeBrowsingResponseCompat callback
    ) {
        statusSink.update("Safe Browsing blocked a dangerous page.");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_RESPONSE_BACK_TO_SAFETY)) {
            callback.backToSafety(true);
        } else {
            view.stopLoading();
        }
    }
}

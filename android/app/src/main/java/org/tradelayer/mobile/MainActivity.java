package org.tradelayer.mobile;

import android.annotation.SuppressLint;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.lifecycle.ViewModelProvider;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

public final class MainActivity extends ComponentActivity {
    static final String TL_WEB_URL = "https://appassets.androidplatform.net/assets/tlweb/index.html";
    static final String AGENT_FALLBACK_URL = "https://appassets.androidplatform.net/assets/mobile/agent-unavailable.html";

    private FrameLayout content;
    private TextView status;
    private WebView tradeLayerView;
    private WebView bitAgentView;
    private ScrollView modelSurface;
    private ScrollView hermesSurface;
    private Button tradeLayerTab;
    private Button bitAgentTab;
    private Button modelTab;
    private Button hermesTab;
    private TextView modelState;
    private TextView modelStorage;
    private ProgressBar modelProgress;
    private Button modelDownloadButton;
    private Button modelCancelButton;
    private Button modelDeleteButton;
    private TextView termuxState;
    private Button termuxPermissionButton;
    private Button hermesCheckButton;
    private Button hermesDoctorButton;
    private Button hermesOpenButton;
    private Button bitAgentSkillButton;
    private Button bitAgentStartButton;
    private Button bitAgentCheckButton;
    private Button bitAgentConnectButton;
    private ModelDownloadViewModel modelDownloadViewModel;
    private boolean localBitAgentReady;
    private Surface currentSurface = Surface.TRADELAYER;

    private static final int TERMUX_PERMISSION_REQUEST = 410;
    private static final String HERMES_INSTALL_COMMAND =
        "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash";

    private enum Surface {
        TRADELAYER,
        BITAGENT,
        MODEL,
        HERMES
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        ServiceWorkerController.getInstance().getServiceWorkerWebSettings().setAllowFileAccess(false);
        ServiceWorkerController.getInstance().getServiceWorkerWebSettings().setAllowContentAccess(false);
        buildNativeShell();
        createWebSurfaces(savedInstanceState);
        createModelSurface();
        createHermesSurface();
        modelDownloadViewModel = new ViewModelProvider(this).get(ModelDownloadViewModel.class);
        modelDownloadViewModel.setListener(this::renderModelSnapshot);
        TermuxBridge.setResultListener(this::onTermuxResult);
        configureBackNavigation();
        showSurface(restoredSurface(savedInstanceState));
    }

    private void buildNativeShell() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(7, 12, 18));

        status = new TextView(this);
        status.setTextColor(Color.rgb(205, 214, 224));
        status.setBackgroundColor(Color.rgb(14, 23, 33));
        status.setTextSize(12f);
        status.setGravity(Gravity.CENTER_VERTICAL);
        int inset = dp(12);
        status.setPadding(inset, dp(8), inset, dp(8));
        status.setText(R.string.status_starting);
        root.addView(status, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));

        LinearLayout tabs = new LinearLayout(this);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        tabs.setBackgroundColor(Color.rgb(14, 23, 33));
        tabs.setPadding(dp(8), dp(6), dp(8), dp(8));

        tradeLayerTab = tabButton(getString(R.string.tab_tradelayer));
        bitAgentTab = tabButton(getString(R.string.tab_bitagent));
        modelTab = tabButton(getString(R.string.tab_model));
        hermesTab = tabButton(getString(R.string.tab_hermes));
        tradeLayerTab.setId(R.id.tab_tradelayer);
        bitAgentTab.setId(R.id.tab_bitagent);
        modelTab.setId(R.id.tab_model);
        hermesTab.setId(R.id.tab_hermes);
        tradeLayerTab.setOnClickListener(view -> showSurface(Surface.TRADELAYER));
        bitAgentTab.setOnClickListener(view -> showSurface(Surface.BITAGENT));
        modelTab.setOnClickListener(view -> showSurface(Surface.MODEL));
        hermesTab.setOnClickListener(view -> showSurface(Surface.HERMES));
        tabs.addView(tradeLayerTab, new LinearLayout.LayoutParams(0, dp(52), 1f));
        tabs.addView(bitAgentTab, new LinearLayout.LayoutParams(0, dp(52), 1f));
        tabs.addView(modelTab, new LinearLayout.LayoutParams(0, dp(52), 1f));
        tabs.addView(hermesTab, new LinearLayout.LayoutParams(0, dp(52), 1f));
        root.addView(tabs, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        setContentView(root);
    }

    private Button tabButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(15f);
        button.setTextColor(Color.WHITE);
        button.setBackgroundColor(Color.TRANSPARENT);
        return button;
    }

    private void createWebSurfaces(Bundle state) {
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        NavigationPolicy tradePolicy = new NavigationPolicy()
            .allow("https://appassets.androidplatform.net", "/assets/tlweb/");
        tradeLayerView = createHardenedWebView(tradePolicy, assetLoader);
        tradeLayerView.setId(R.id.webview_tradelayer);
        content.addView(tradeLayerView, matchParent());

        String agentUrl = BuildConfig.BITAGENT_URL.trim();
        NavigationPolicy agentPolicy = new NavigationPolicy()
            .allow("https://appassets.androidplatform.net", "/assets/mobile/");
        if (NavigationPolicy.isSafeAgentUrl(agentUrl, BuildConfig.DEBUG)) {
            agentPolicy.allow(agentUrl, "/");
        } else {
            agentUrl = AGENT_FALLBACK_URL;
        }
        bitAgentView = createHardenedWebView(agentPolicy, assetLoader);
        bitAgentView.setId(R.id.webview_bitagent);
        content.addView(bitAgentView, matchParent());

        boolean restoredTrade = state != null && tradeLayerView.restoreState(state.getBundle("tlWebState")) != null;
        boolean restoredAgent = state != null && bitAgentView.restoreState(state.getBundle("agentState")) != null;
        if (!restoredTrade) tradeLayerView.loadUrl(TL_WEB_URL);
        if (!restoredAgent) bitAgentView.loadUrl(agentUrl);
    }

    private void createModelSurface() {
        modelSurface = new ScrollView(this);
        modelSurface.setId(R.id.model_surface);
        modelSurface.setFillViewport(true);
        modelSurface.setBackgroundColor(Color.rgb(7, 12, 18));

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(20), dp(20), dp(20), dp(28));

        TextView title = modelText(24f, Color.WHITE);
        title.setText(R.string.model_title);
        panel.addView(title, wrapContent());

        TextView summary = modelText(15f, Color.rgb(205, 214, 224));
        summary.setText(R.string.model_summary);
        summary.setPadding(0, dp(10), 0, dp(14));
        panel.addView(summary, wrapContent());

        TextView packageDetails = modelText(14f, Color.rgb(149, 174, 201));
        packageDetails.setText(getString(
            R.string.model_package_details,
            ModelDownloadPolicy.formatGib(ModelPackageManifest.TOTAL_BYTES)
        ));
        panel.addView(packageDetails, wrapContent());

        modelState = modelText(16f, Color.WHITE);
        modelState.setId(R.id.model_state);
        modelState.setPadding(0, dp(18), 0, dp(8));
        panel.addView(modelState, wrapContent());

        modelStorage = modelText(14f, Color.rgb(149, 174, 201));
        modelStorage.setId(R.id.model_storage);
        panel.addView(modelStorage, wrapContent());

        modelProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        modelProgress.setId(R.id.model_progress);
        modelProgress.setMax(10_000);
        modelProgress.setPadding(0, dp(12), 0, dp(12));
        panel.addView(modelProgress, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(36)
        ));

        modelDownloadButton = actionButton(getString(R.string.model_download));
        modelDownloadButton.setId(R.id.model_download);
        modelDownloadButton.setOnClickListener(view -> modelDownloadViewModel.startDownload());
        panel.addView(modelDownloadButton, buttonLayout());

        modelCancelButton = actionButton(getString(R.string.model_cancel));
        modelCancelButton.setId(R.id.model_cancel);
        modelCancelButton.setOnClickListener(view -> modelDownloadViewModel.cancelDownload());
        panel.addView(modelCancelButton, buttonLayout());

        Button recheckButton = actionButton(getString(R.string.model_recheck));
        recheckButton.setId(R.id.model_recheck);
        recheckButton.setOnClickListener(view -> modelDownloadViewModel.refreshStorage());
        panel.addView(recheckButton, buttonLayout());

        modelDeleteButton = actionButton(getString(R.string.model_delete));
        modelDeleteButton.setId(R.id.model_delete);
        modelDeleteButton.setOnClickListener(view -> modelDownloadViewModel.deletePackage());
        panel.addView(modelDeleteButton, buttonLayout());

        TextView boundary = modelText(13f, Color.rgb(149, 174, 201));
        boundary.setText(R.string.model_authority_boundary);
        boundary.setPadding(0, dp(18), 0, 0);
        panel.addView(boundary, wrapContent());

        modelSurface.addView(panel, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        content.addView(modelSurface, matchParent());
    }

    private void createHermesSurface() {
        hermesSurface = new ScrollView(this);
        hermesSurface.setId(R.id.hermes_surface);
        hermesSurface.setFillViewport(true);
        hermesSurface.setBackgroundColor(Color.rgb(7, 12, 18));

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(20), dp(20), dp(20), dp(28));

        TextView title = modelText(24f, Color.WHITE);
        title.setText(R.string.hermes_title);
        panel.addView(title, wrapContent());

        TextView summary = modelText(15f, Color.rgb(205, 214, 224));
        summary.setText(R.string.hermes_summary);
        summary.setPadding(0, dp(10), 0, dp(14));
        panel.addView(summary, wrapContent());

        termuxState = modelText(14f, Color.rgb(149, 174, 201));
        termuxState.setId(R.id.termux_state);
        panel.addView(termuxState, wrapContent());

        Button openTermuxButton = actionButton(getString(R.string.termux_open));
        openTermuxButton.setId(R.id.termux_open);
        openTermuxButton.setOnClickListener(view -> openTermux());
        panel.addView(openTermuxButton, buttonLayout());

        Button copyInstallButton = actionButton(getString(R.string.hermes_copy_install));
        copyInstallButton.setId(R.id.hermes_copy_install);
        copyInstallButton.setOnClickListener(view -> copyHermesInstallCommand());
        panel.addView(copyInstallButton, buttonLayout());

        termuxPermissionButton = actionButton(getString(R.string.termux_grant_permission));
        termuxPermissionButton.setId(R.id.termux_grant_permission);
        termuxPermissionButton.setOnClickListener(view -> requestTermuxPermission());
        panel.addView(termuxPermissionButton, buttonLayout());

        hermesCheckButton = termuxCommandButton(
            panel,
            R.id.hermes_check,
            R.string.hermes_check,
            TermuxBridge.Command.HERMES_VERSION
        );
        hermesDoctorButton = termuxCommandButton(
            panel,
            R.id.hermes_doctor,
            R.string.hermes_doctor,
            TermuxBridge.Command.HERMES_DOCTOR
        );
        bitAgentSkillButton = termuxCommandButton(
            panel,
            R.id.bitagent_skill_install,
            R.string.bitagent_skill_install,
            TermuxBridge.Command.BITAGENT_SKILL_INSTALL
        );
        bitAgentStartButton = termuxCommandButton(
            panel,
            R.id.bitagent_local_start,
            R.string.bitagent_local_start,
            TermuxBridge.Command.BITAGENT_START
        );
        bitAgentCheckButton = termuxCommandButton(
            panel,
            R.id.bitagent_local_check,
            R.string.bitagent_local_check,
            TermuxBridge.Command.BITAGENT_STATUS
        );

        bitAgentConnectButton = actionButton(getString(R.string.bitagent_local_connect));
        bitAgentConnectButton.setId(R.id.bitagent_local_connect);
        bitAgentConnectButton.setEnabled(false);
        bitAgentConnectButton.setOnClickListener(view -> connectLocalBitAgent());
        panel.addView(bitAgentConnectButton, buttonLayout());

        hermesOpenButton = termuxCommandButton(
            panel,
            R.id.hermes_open,
            R.string.hermes_open,
            TermuxBridge.Command.HERMES_OPEN
        );

        TextView boundary = modelText(13f, Color.rgb(149, 174, 201));
        boundary.setText(R.string.hermes_authority_boundary);
        boundary.setPadding(0, dp(18), 0, 0);
        panel.addView(boundary, wrapContent());

        hermesSurface.addView(panel, new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        content.addView(hermesSurface, matchParent());
        renderTermuxState();
    }

    private Button termuxCommandButton(
        LinearLayout panel,
        int id,
        int label,
        TermuxBridge.Command command
    ) {
        Button button = actionButton(getString(label));
        button.setId(id);
        button.setOnClickListener(view -> runTermuxCommand(command));
        panel.addView(button, buttonLayout());
        return button;
    }

    private void openTermux() {
        try {
            TermuxBridge.openTermux(this);
        } catch (RuntimeException error) {
            setStatus(error.getMessage());
        }
    }

    private void copyHermesInstallCommand() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("Hermes Termux install", HERMES_INSTALL_COMMAND));
        setStatus("Hermes install command copied. Review it, then paste it in Termux.");
    }

    private void requestTermuxPermission() {
        if (!TermuxBridge.isInstalled(this)) {
            setStatus("Install Termux from F-Droid first.");
            return;
        }
        requestPermissions(
            new String[]{TermuxBridge.RUN_COMMAND_PERMISSION},
            TERMUX_PERMISSION_REQUEST
        );
    }

    private void openOwnAppSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getPackageName()));
        startActivity(intent);
    }

    private void runTermuxCommand(TermuxBridge.Command command) {
        try {
            TermuxBridge.run(this, command);
            setStatus(command.label + " sent to Termux by explicit user action.");
        } catch (SecurityException error) {
            setStatus(error.getMessage());
            openOwnAppSettings();
        } catch (RuntimeException error) {
            setStatus(error.getMessage());
        }
    }

    private void onTermuxResult(TermuxBridge.Result result) {
        runOnUiThread(() -> {
            if (result.command == TermuxBridge.Command.BITAGENT_STATUS ||
                result.command == TermuxBridge.Command.BITAGENT_START) {
                localBitAgentReady = result.ok && result.summary.contains("bitagent-ready");
                bitAgentConnectButton.setEnabled(localBitAgentReady);
            }
            String outcome = result.ok ? "completed" : "failed (exit " + result.exitCode + ")";
            setStatus(result.command.label + " " + outcome + ": " + result.summary);
            renderTermuxState();
        });
    }

    private void connectLocalBitAgent() {
        if (!localBitAgentReady) {
            setStatus("Check the local BitAgent service before connecting.");
            return;
        }
        bitAgentView.loadUrl(TermuxBridge.LOCAL_BITAGENT_URL);
        showSurface(Surface.BITAGENT);
    }

    private void renderTermuxState() {
        if (termuxState == null) return;
        boolean installed = TermuxBridge.isInstalled(this);
        boolean permitted = installed && TermuxBridge.hasPermission(this);
        termuxState.setText(getString(
            R.string.termux_state,
            installed ? getString(R.string.state_ready) : getString(R.string.state_missing),
            permitted ? getString(R.string.state_granted) : getString(R.string.state_missing),
            localBitAgentReady ? getString(R.string.state_ready) : getString(R.string.state_not_checked)
        ));
        termuxPermissionButton.setEnabled(installed && !permitted);
        for (Button button : new Button[]{
            hermesCheckButton,
            hermesDoctorButton,
            hermesOpenButton,
            bitAgentSkillButton,
            bitAgentStartButton,
            bitAgentCheckButton
        }) {
            button.setEnabled(permitted);
        }
    }

    private TextView modelText(float size, int color) {
        TextView view = new TextView(this);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(0f, 1.15f);
        return view;
    }

    private Button actionButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(15f);
        return button;
    }

    private LinearLayout.LayoutParams buttonLayout() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(52)
        );
        params.topMargin = dp(8);
        return params;
    }

    private LinearLayout.LayoutParams wrapContent() {
        return new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
    }

    @SuppressLint("SetJavaScriptEnabled")
    @SuppressWarnings("deprecation")
    private WebView createHardenedWebView(
        NavigationPolicy policy,
        WebViewAssetLoader assetLoader
    ) {
        WebView view = new WebView(this);
        WebSettings settings = view.getSettings();
        // Both approved web surfaces require JavaScript. Navigation, file access, mixed content,
        // permissions, pop-ups, downloads, and native bridges remain denied below.
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
        }

        view.removeJavascriptInterface("searchBoxJavaBridge_");
        view.removeJavascriptInterface("accessibility");
        view.removeJavascriptInterface("accessibilityTraversal");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        view.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) ->
            setStatus("Downloads are disabled in the wallet shell. Open an approved HTTPS link externally instead."));
        view.setWebViewClient(new SecureWebViewClient(this, policy, assetLoader, this::setStatus));
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
                setStatus("Web content permission request denied.");
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
            ) {
                callback.invoke(origin, false, false);
                setStatus("Location access denied.");
            }

            @Override
            public boolean onCreateWindow(WebView webView, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                setStatus("Pop-up window blocked.");
                return false;
            }

            @Override
            public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                filePathCallback.onReceiveValue(null);
                setStatus("File selection is not exposed by the mobile wallet shell.");
                return true;
            }
        });
        return view;
    }

    private void showSurface(Surface surface) {
        currentSurface = surface;
        tradeLayerView.setVisibility(surface == Surface.TRADELAYER ? View.VISIBLE : View.GONE);
        bitAgentView.setVisibility(surface == Surface.BITAGENT ? View.VISIBLE : View.GONE);
        modelSurface.setVisibility(surface == Surface.MODEL ? View.VISIBLE : View.GONE);
        hermesSurface.setVisibility(surface == Surface.HERMES ? View.VISIBLE : View.GONE);
        tradeLayerTab.setBackgroundColor(
            surface == Surface.TRADELAYER ? Color.rgb(31, 113, 235) : Color.TRANSPARENT
        );
        bitAgentTab.setBackgroundColor(
            surface == Surface.BITAGENT ? Color.rgb(31, 113, 235) : Color.TRANSPARENT
        );
        modelTab.setBackgroundColor(
            surface == Surface.MODEL ? Color.rgb(31, 113, 235) : Color.TRANSPARENT
        );
        hermesTab.setBackgroundColor(
            surface == Surface.HERMES ? Color.rgb(31, 113, 235) : Color.TRANSPARENT
        );
        if (surface == Surface.MODEL) {
            modelDownloadViewModel.refreshStorage();
            setStatus("Model · optional local package · explicit download · no wallet authority");
        } else if (surface == Surface.HERMES) {
            renderTermuxState();
            setStatus("Hermes + Termux - fixed user-triggered commands - BitAgent remains candidate-only");
        } else if (surface == Surface.BITAGENT) {
            setStatus("BitAgent · proposals and simulations only · wallet approval remains separate");
        } else {
            setStatus("TradeLayer · packaged TL Web · exact wallet effects remain authoritative");
        }
    }

    private Surface restoredSurface(Bundle state) {
        if (state == null) {
            return Surface.TRADELAYER;
        }
        int ordinal = state.getInt("surface", -1);
        if (ordinal >= 0 && ordinal < Surface.values().length) {
            return Surface.values()[ordinal];
        }
        return state.getBoolean("showingAgent", false) ? Surface.BITAGENT : Surface.TRADELAYER;
    }

    private void renderModelSnapshot(ModelDownloadSnapshot snapshot) {
        runOnUiThread(() -> {
            modelState.setText(snapshot.message());
            modelStorage.setText(getString(
                R.string.model_storage_status,
                ModelDownloadPolicy.formatGib(snapshot.availableBytes()),
                ModelDownloadPolicy.formatGib(snapshot.requiredBytes())
            ));
            int progress = snapshot.totalBytes() == 0L
                ? 0
                : (int) Math.min(10_000L, snapshot.completedBytes() * 10_000L / snapshot.totalBytes());
            modelProgress.setProgress(progress);
            boolean busy = snapshot.phase() == ModelDownloadSnapshot.Phase.CHECKING_STORAGE ||
                snapshot.phase() == ModelDownloadSnapshot.Phase.VERIFYING ||
                snapshot.phase() == ModelDownloadSnapshot.Phase.DOWNLOADING ||
                snapshot.phase() == ModelDownloadSnapshot.Phase.DELETING;
            boolean verified = snapshot.phase() == ModelDownloadSnapshot.Phase.VERIFIED_NOT_ENABLED;
            boolean enoughSpace = snapshot.requiredBytes() > 0L &&
                snapshot.availableBytes() >= snapshot.requiredBytes();
            modelDownloadButton.setEnabled(!busy && !verified && enoughSpace);
            modelCancelButton.setEnabled(busy && snapshot.phase() != ModelDownloadSnapshot.Phase.DELETING);
            modelDeleteButton.setEnabled(snapshot.phase() != ModelDownloadSnapshot.Phase.DELETING);
        });
    }

    private void setStatus(String message) {
        runOnUiThread(() -> status.setText(message));
    }

    private FrameLayout.LayoutParams matchParent() {
        return new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        Bundle tlWebState = new Bundle();
        Bundle agentState = new Bundle();
        tradeLayerView.saveState(tlWebState);
        bitAgentView.saveState(agentState);
        outState.putBundle("tlWebState", tlWebState);
        outState.putBundle("agentState", agentState);
        outState.putInt("surface", currentSurface.ordinal());
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onPause() {
        tradeLayerView.onPause();
        bitAgentView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        tradeLayerView.onResume();
        bitAgentView.onResume();
    }

    private void configureBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (currentSurface == Surface.MODEL || currentSurface == Surface.HERMES) {
                    finishAfterTransition();
                    return;
                }
                WebView current = currentSurface == Surface.BITAGENT ? bitAgentView : tradeLayerView;
                if (current.canGoBack()) current.goBack();
                else finishAfterTransition();
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(
        int requestCode,
        String[] permissions,
        int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != TERMUX_PERMISSION_REQUEST) return;
        boolean granted = grantResults.length > 0 &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED;
        setStatus(granted
            ? "Termux command permission granted."
            : "Permission not granted. Open App info > Permissions > Additional permissions.");
        renderTermuxState();
    }

    @Override
    protected void onDestroy() {
        if (modelDownloadViewModel != null) {
            modelDownloadViewModel.setListener(null);
        }
        TermuxBridge.setResultListener(null);
        destroyWebView(tradeLayerView);
        destroyWebView(bitAgentView);
        super.onDestroy();
    }

    private void destroyWebView(WebView view) {
        view.stopLoading();
        view.setWebChromeClient(null);
        view.setWebViewClient(new WebViewClient());
        view.removeAllViews();
        view.destroy();
    }
}

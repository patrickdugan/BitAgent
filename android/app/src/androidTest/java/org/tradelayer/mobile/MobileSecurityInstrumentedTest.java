package org.tradelayer.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

@RunWith(AndroidJUnit4.class)
public final class MobileSecurityInstrumentedTest {
    @Test
    public void manifestRequestsNoSensitiveDevicePermissions() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        PackageInfo info = context.getPackageManager().getPackageInfo(
            context.getPackageName(),
            PackageManager.GET_PERMISSIONS
        );
        assertNotNull(info.requestedPermissions);
        Set<String> requested = new HashSet<>(Arrays.asList(info.requestedPermissions));
        assertEquals(Set.of(
            Manifest.permission.INTERNET,
            TermuxBridge.RUN_COMMAND_PERMISSION,
            context.getPackageName() + ".DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
        ), requested);
    }

    @Test
    public void bothWebViewsFailClosedOnNativeCapabilities() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                WebView tlWeb = activity.findViewById(R.id.webview_tradelayer);
                WebView agent = activity.findViewById(R.id.webview_bitagent);
                assertNotNull(tlWeb);
                assertNotNull(agent);
                for (WebView view : new WebView[]{tlWeb, agent}) {
                    WebSettings settings = view.getSettings();
                    assertTrue(settings.getJavaScriptEnabled());
                    assertTrue(settings.getDomStorageEnabled());
                    assertFalse(settings.getAllowFileAccess());
                    assertFalse(settings.getAllowContentAccess());
                    assertFalse(settings.getAllowFileAccessFromFileURLs());
                    assertFalse(settings.getAllowUniversalAccessFromFileURLs());
                    assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, settings.getMixedContentMode());
                }
            });
        }
    }

    @Test
    public void apkContainsNoBundledModelWeights() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        try (ZipFile apk = new ZipFile(context.getPackageCodePath())) {
            java.util.Enumeration<? extends ZipEntry> entries = apk.entries();
            while (entries.hasMoreElements()) {
                String name = entries.nextElement().getName().toLowerCase(java.util.Locale.ROOT);
                assertFalse(name.endsWith(".gguf"));
                assertFalse(name.endsWith(".safetensors"));
                assertFalse(name.contains("adapter_model.bin"));
            }
        }
    }

    @Test
    public void launchDoesNotStartAModelDownload() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        ModelStore store = new ModelStore(context);
        store.deleteAll();
        try (ActivityScenario<MainActivity> ignored = ActivityScenario.launch(MainActivity.class)) {
            assertFalse(ModelPackageManifest.AUTO_DOWNLOAD);
            for (ModelArtifact artifact : ModelPackageManifest.ARTIFACTS) {
                assertFalse(store.artifactFile(artifact).exists());
                assertFalse(store.partialFile(artifact).exists());
            }
        }
    }

    @Test
    public void modelDeletionIsConfinedToNoBackupStorage() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        ModelStore store = new ModelStore(context);
        store.deleteAll();
        store.ensureRoot();
        File partial = store.partialFile(ModelPackageManifest.ARTIFACTS.get(0));
        try (FileOutputStream output = new FileOutputStream(partial)) {
            output.write(new byte[]{1, 2, 3});
        }
        File unrelated = new File(context.getNoBackupFilesDir(), "model-delete-boundary-control.txt");
        try (FileOutputStream output = new FileOutputStream(unrelated)) {
            output.write(7);
        }

        String root = ModelStore.modelRoot(context).getCanonicalPath();
        String noBackup = context.getNoBackupFilesDir().getCanonicalPath() + File.separator;
        assertTrue(root.startsWith(noBackup));
        store.deleteAll();
        assertFalse(partial.exists());
        assertTrue(unrelated.exists());
        assertTrue(unrelated.delete());
    }
}

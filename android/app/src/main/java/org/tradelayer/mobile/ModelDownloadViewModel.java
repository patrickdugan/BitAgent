package org.tradelayer.mobile;

import android.app.Application;

import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class ModelDownloadViewModel extends AndroidViewModel {
    interface Listener {
        void onModelDownloadState(ModelDownloadSnapshot snapshot);
    }

    private static final int MAX_REDIRECTS = 6;
    private static final int CONNECT_TIMEOUT_MS = 30_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    private final ModelStore store;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancellationRequested = new AtomicBoolean(false);
    private final Object operationLock = new Object();

    private volatile ModelDownloadSnapshot snapshot;
    private volatile Listener listener;
    private volatile HttpURLConnection activeConnection;
    private boolean busy;
    private boolean deleteAfterCurrentOperation;

    public ModelDownloadViewModel(@NonNull Application application) {
        super(application);
        store = new ModelStore(application);
        snapshot = storageSnapshot(
            store.isVerifiedPackagePresent()
                ? ModelDownloadSnapshot.Phase.VERIFIED_NOT_ENABLED
                : ModelDownloadSnapshot.Phase.IDLE,
            store.isVerifiedPackagePresent()
                ? "Downloaded and verified. Runtime is not enabled."
                : "Not downloaded. Nothing is fetched until you tap Download model."
        );
    }

    void setListener(Listener listener) {
        this.listener = listener;
        if (listener != null) {
            listener.onModelDownloadState(snapshot);
        }
    }

    ModelDownloadSnapshot currentSnapshot() {
        return snapshot;
    }

    void refreshStorage() {
        synchronized (operationLock) {
            if (busy) {
                return;
            }
            ModelDownloadSnapshot.Phase phase = store.isVerifiedPackagePresent()
                ? ModelDownloadSnapshot.Phase.VERIFIED_NOT_ENABLED
                : ModelDownloadSnapshot.Phase.IDLE;
            publish(storageSnapshot(
                phase,
                phase == ModelDownloadSnapshot.Phase.VERIFIED_NOT_ENABLED
                    ? "Downloaded and verified. Runtime is not enabled."
                    : "Storage rechecked. Download remains a user action."
            ));
        }
    }

    void startDownload() {
        synchronized (operationLock) {
            if (busy || ModelPackageManifest.AUTO_DOWNLOAD) {
                return;
            }
            busy = true;
            deleteAfterCurrentOperation = false;
            cancellationRequested.set(false);
        }
        publish(storageSnapshot(
            ModelDownloadSnapshot.Phase.CHECKING_STORAGE,
            "Checking app-private storage before download."
        ));
        executor.execute(this::downloadPackage);
    }

    void cancelDownload() {
        synchronized (operationLock) {
            if (!busy) {
                return;
            }
            cancellationRequested.set(true);
            HttpURLConnection connection = activeConnection;
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    void deletePackage() {
        synchronized (operationLock) {
            if (busy) {
                deleteAfterCurrentOperation = true;
                cancellationRequested.set(true);
                HttpURLConnection connection = activeConnection;
                if (connection != null) {
                    connection.disconnect();
                }
                publish(new ModelDownloadSnapshot(
                    ModelDownloadSnapshot.Phase.DELETING,
                    "Canceling the transfer, then deleting local model files.",
                    snapshot.completedBytes(),
                    ModelPackageManifest.TOTAL_BYTES,
                    snapshot.availableBytes(),
                    snapshot.requiredBytes()
                ));
                return;
            }
            busy = true;
        }
        executor.execute(this::performDelete);
    }

    private void downloadPackage() {
        long available = 0L;
        long completed = 0L;
        try {
            available = store.availableBytes();
            if (!ModelDownloadPolicy.hasEnoughStorage(available, ModelPackageManifest.TOTAL_BYTES)) {
                publish(new ModelDownloadSnapshot(
                    ModelDownloadSnapshot.Phase.INSUFFICIENT_SPACE,
                    "Not enough free app storage for the package and safety reserve.",
                    0L,
                    ModelPackageManifest.TOTAL_BYTES,
                    available,
                    ModelDownloadPolicy.requiredFreeBytes(ModelPackageManifest.TOTAL_BYTES)
                ));
                return;
            }

            store.clearVerifiedMarker();
            for (ModelArtifact artifact : ModelPackageManifest.ARTIFACTS) {
                throwIfCanceled();
                File finalFile = store.artifactFile(artifact);
                if (finalFile.isFile()) {
                    publish(progressSnapshot(
                        ModelDownloadSnapshot.Phase.VERIFYING,
                        "Verifying existing " + artifact.role() + " artifact.",
                        completed,
                        available
                    ));
                    if (ArtifactIntegrity.matches(finalFile, artifact)) {
                        completed += artifact.bytes();
                        continue;
                    }
                    store.deleteArtifact(artifact);
                }
                downloadArtifact(artifact, completed, available);
                completed += artifact.bytes();
            }
            store.markVerified();
            publish(new ModelDownloadSnapshot(
                ModelDownloadSnapshot.Phase.VERIFIED_NOT_ENABLED,
                "Downloaded and verified. Runtime is not enabled; wallet authority is unchanged.",
                ModelPackageManifest.TOTAL_BYTES,
                ModelPackageManifest.TOTAL_BYTES,
                store.availableBytes(),
                0L
            ));
        } catch (DownloadCanceledException exception) {
            publish(progressSnapshot(
                ModelDownloadSnapshot.Phase.CANCELED,
                "Download canceled. A verified artifact was not created from partial data.",
                completed,
                available
            ));
        } catch (IOException | RuntimeException exception) {
            if (cancellationRequested.get()) {
                publish(progressSnapshot(
                    ModelDownloadSnapshot.Phase.CANCELED,
                    "Download canceled. A verified artifact was not created from partial data.",
                    completed,
                    available
                ));
            } else {
                publish(progressSnapshot(
                    ModelDownloadSnapshot.Phase.FAILED,
                    safeFailureMessage(exception),
                    completed,
                    available
                ));
            }
        } finally {
            boolean delete;
            synchronized (operationLock) {
                delete = deleteAfterCurrentOperation;
                if (!delete) {
                    busy = false;
                }
            }
            if (delete) {
                performDelete();
            }
        }
    }

    private void downloadArtifact(ModelArtifact artifact, long completedBefore, long available)
        throws IOException, DownloadCanceledException {
        store.ensureRoot();
        File partial = store.partialFile(artifact);
        if (partial.exists() && (!partial.isFile() || partial.length() > artifact.bytes())) {
            store.deletePartial(artifact);
        }

        long offset = partial.isFile() ? partial.length() : 0L;
        MessageDigest digest = ArtifactIntegrity.newDigest();
        if (offset > 0L) {
            publish(progressSnapshot(
                ModelDownloadSnapshot.Phase.VERIFYING,
                "Checking the partial " + artifact.role() + " download before resume.",
                completedBefore,
                available
            ));
            updateDigestFromFile(digest, partial);
        }

        HttpURLConnection connection = openConnection(artifact.downloadUri(), offset);
        boolean append = offset > 0L;
        int responseCode = connection.getResponseCode();
        if (offset > 0L && responseCode == HttpURLConnection.HTTP_OK) {
            append = false;
            offset = 0L;
            digest = ArtifactIntegrity.newDigest();
        } else if (responseCode == HttpURLConnection.HTTP_PARTIAL) {
            String expectedPrefix = "bytes " + offset + "-";
            String contentRange = connection.getHeaderField("Content-Range");
            if (contentRange == null || !contentRange.startsWith(expectedPrefix)) {
                connection.disconnect();
                throw new IOException("The model host returned an invalid resume range.");
            }
        } else if (responseCode != HttpURLConnection.HTTP_OK) {
            connection.disconnect();
            throw new IOException("The model host rejected the download.");
        }

        long expectedRemaining = artifact.bytes() - offset;
        long contentLength = connection.getContentLengthLong();
        if (contentLength > expectedRemaining) {
            connection.disconnect();
            throw new IOException("The model host returned more data than the pinned artifact length.");
        }

        activeConnection = connection;
        long artifactBytes = offset;
        try (
            InputStream input = new BufferedInputStream(connection.getInputStream(), 256 * 1024);
            BufferedOutputStream output = new BufferedOutputStream(
                new FileOutputStream(partial, append),
                256 * 1024
            )
        ) {
            byte[] buffer = new byte[256 * 1024];
            int read;
            long lastPublished = artifactBytes;
            while ((read = input.read(buffer)) != -1) {
                throwIfCanceled();
                artifactBytes += read;
                if (artifactBytes > artifact.bytes()) {
                    throw new IOException("The model download exceeded its pinned byte length.");
                }
                output.write(buffer, 0, read);
                digest.update(buffer, 0, read);
                if (artifactBytes - lastPublished >= 4L * 1024L * 1024L) {
                    lastPublished = artifactBytes;
                    publish(progressSnapshot(
                        ModelDownloadSnapshot.Phase.DOWNLOADING,
                        "Downloading verified " + artifact.role() + " artifact from Hugging Face.",
                        completedBefore + artifactBytes,
                        available
                    ));
                }
            }
            output.flush();
        } finally {
            activeConnection = null;
            connection.disconnect();
        }

        throwIfCanceled();
        if (artifactBytes != artifact.bytes()) {
            throw new IOException("The model download ended before the pinned byte length.");
        }
        String actualSha256 = ArtifactIntegrity.hex(digest.digest());
        if (!artifact.sha256().equals(actualSha256)) {
            store.deletePartial(artifact);
            throw new IOException("The model download failed SHA-256 verification.");
        }
        store.deleteArtifact(artifact);
        if (!partial.renameTo(store.artifactFile(artifact))) {
            throw new IOException("Unable to finalize the verified model artifact.");
        }
        publish(progressSnapshot(
            ModelDownloadSnapshot.Phase.VERIFYING,
            "Verified " + artifact.role() + " artifact.",
            completedBefore + artifact.bytes(),
            available
        ));
    }

    private HttpURLConnection openConnection(URI initialUri, long offset) throws IOException {
        URI current = initialUri;
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            if (!ModelDownloadPolicy.isAllowedHuggingFaceUri(current)) {
                throw new IOException("The model host redirected outside the approved Hugging Face boundary.");
            }
            URL url = current.toURL();
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("User-Agent", "TradeLayer-Mobile/0.1 model-fetch");
            if (offset > 0L) {
                connection.setRequestProperty("Range", "bytes=" + offset + "-");
            }
            int response = connection.getResponseCode();
            if (!isRedirect(response)) {
                return connection;
            }
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null || location.isBlank()) {
                throw new IOException("The model host returned an empty redirect.");
            }
            current = current.resolve(location);
        }
        throw new IOException("The model download exceeded the redirect limit.");
    }

    private static boolean isRedirect(int response) {
        return response == HttpURLConnection.HTTP_MOVED_PERM ||
            response == HttpURLConnection.HTTP_MOVED_TEMP ||
            response == HttpURLConnection.HTTP_SEE_OTHER ||
            response == 307 || response == 308;
    }

    private void updateDigestFromFile(MessageDigest digest, File file)
        throws IOException, DownloadCanceledException {
        try (InputStream input = new BufferedInputStream(new FileInputStream(file), 256 * 1024)) {
            byte[] buffer = new byte[256 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                throwIfCanceled();
                digest.update(buffer, 0, read);
            }
        }
    }

    private void performDelete() {
        publish(new ModelDownloadSnapshot(
            ModelDownloadSnapshot.Phase.DELETING,
            "Deleting final and partial model files from app-private storage.",
            0L,
            ModelPackageManifest.TOTAL_BYTES,
            snapshot.availableBytes(),
            snapshot.requiredBytes()
        ));
        try {
            store.deleteAll();
            publish(storageSnapshot(
                ModelDownloadSnapshot.Phase.IDLE,
                "All local model package state was deleted. No model is installed."
            ));
        } catch (IOException exception) {
            publish(storageSnapshot(
                ModelDownloadSnapshot.Phase.FAILED,
                "Could not delete all local model files. No broader deletion was attempted."
            ));
        } finally {
            synchronized (operationLock) {
                cancellationRequested.set(false);
                deleteAfterCurrentOperation = false;
                busy = false;
            }
        }
    }

    private ModelDownloadSnapshot storageSnapshot(ModelDownloadSnapshot.Phase phase, String message) {
        long available = 0L;
        try {
            available = store.availableBytes();
        } catch (IOException ignored) {
            // The UI retains a zero value and the actual operation will fail closed.
        }
        long missing = store.isVerifiedPackagePresent() ? 0L : ModelPackageManifest.TOTAL_BYTES;
        return new ModelDownloadSnapshot(
            phase,
            message,
            store.isVerifiedPackagePresent() ? ModelPackageManifest.TOTAL_BYTES : 0L,
            ModelPackageManifest.TOTAL_BYTES,
            available,
            missing == 0L ? 0L : ModelDownloadPolicy.requiredFreeBytes(missing)
        );
    }

    private ModelDownloadSnapshot progressSnapshot(
        ModelDownloadSnapshot.Phase phase,
        String message,
        long completed,
        long available
    ) {
        return new ModelDownloadSnapshot(
            phase,
            message,
            Math.max(0L, Math.min(completed, ModelPackageManifest.TOTAL_BYTES)),
            ModelPackageManifest.TOTAL_BYTES,
            available,
            ModelDownloadPolicy.requiredFreeBytes(ModelPackageManifest.TOTAL_BYTES)
        );
    }

    private static String safeFailureMessage(Exception exception) {
        // Network exceptions may contain temporary signed delivery URLs. Keep them out of UI,
        // logs, telemetry, and crash breadcrumbs; the downloader always fails closed.
        return "Model download failed closed. Retry after checking storage and connectivity.";
    }

    private void throwIfCanceled() throws DownloadCanceledException {
        if (cancellationRequested.get() || Thread.currentThread().isInterrupted()) {
            throw new DownloadCanceledException();
        }
    }

    private void publish(ModelDownloadSnapshot next) {
        snapshot = next;
        Listener current = listener;
        if (current != null) {
            current.onModelDownloadState(next);
        }
    }

    @Override
    protected void onCleared() {
        cancellationRequested.set(true);
        HttpURLConnection connection = activeConnection;
        if (connection != null) {
            connection.disconnect();
        }
        executor.shutdownNow();
        super.onCleared();
    }

    private static final class DownloadCanceledException extends Exception {
    }
}

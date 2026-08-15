package org.tradelayer.mobile;

import android.content.Context;
import android.os.StatFs;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

final class ModelStore {
    private static final String DIRECTORY_NAME = "bitagent-bonsai-v3";
    private static final String VERIFIED_MARKER = "verified-package.txt";

    private final File root;

    ModelStore(Context context) {
        root = modelRoot(context);
    }

    static File modelRoot(Context context) {
        return new File(new File(context.getNoBackupFilesDir(), "models"), DIRECTORY_NAME);
    }

    File artifactFile(ModelArtifact artifact) {
        return new File(root, artifact.fileName());
    }

    File partialFile(ModelArtifact artifact) {
        return new File(root, artifact.fileName() + ".part");
    }

    long availableBytes() throws IOException {
        ensureRoot();
        return new StatFs(root.getAbsolutePath()).getAvailableBytes();
    }

    boolean isVerifiedPackagePresent() {
        File marker = new File(root, VERIFIED_MARKER);
        if (!marker.isFile() || marker.length() != ModelPackageManifest.PACKAGE_ID.length()) {
            return false;
        }
        try (FileInputStream input = new FileInputStream(marker)) {
            byte[] bytes = new byte[ModelPackageManifest.PACKAGE_ID.length()];
            int offset = 0;
            while (offset < bytes.length) {
                int read = input.read(bytes, offset, bytes.length - offset);
                if (read == -1) {
                    return false;
                }
                offset += read;
            }
            String markerValue = new String(bytes, StandardCharsets.US_ASCII);
            if (!ModelPackageManifest.PACKAGE_ID.equals(markerValue)) {
                return false;
            }
        } catch (IOException exception) {
            return false;
        }
        for (ModelArtifact artifact : ModelPackageManifest.ARTIFACTS) {
            File file = artifactFile(artifact);
            if (!file.isFile() || file.length() != artifact.bytes()) {
                return false;
            }
        }
        return true;
    }

    void markVerified() throws IOException {
        ensureRoot();
        File marker = new File(root, VERIFIED_MARKER);
        try (FileOutputStream output = new FileOutputStream(marker, false)) {
            output.write(ModelPackageManifest.PACKAGE_ID.getBytes(StandardCharsets.US_ASCII));
            output.getFD().sync();
        }
    }

    void clearVerifiedMarker() throws IOException {
        deleteIfPresent(new File(root, VERIFIED_MARKER));
    }

    void deleteArtifact(ModelArtifact artifact) throws IOException {
        deleteIfPresent(artifactFile(artifact));
    }

    void deletePartial(ModelArtifact artifact) throws IOException {
        deleteIfPresent(partialFile(artifact));
    }

    void deleteAll() throws IOException {
        for (ModelArtifact artifact : ModelPackageManifest.ARTIFACTS) {
            deleteIfPresent(artifactFile(artifact));
            deleteIfPresent(partialFile(artifact));
        }
        clearVerifiedMarker();
        if (root.isDirectory()) {
            File[] unexpected = root.listFiles();
            if (unexpected == null) {
                throw new IOException("Unable to inspect the model directory after deletion.");
            }
            if (unexpected.length == 0 && !root.delete()) {
                throw new IOException("Unable to remove the empty model directory.");
            }
        }
    }

    void ensureRoot() throws IOException {
        if (root.isDirectory()) {
            return;
        }
        if (root.exists() || !root.mkdirs()) {
            throw new IOException("Unable to create app-private model storage.");
        }
    }

    private static void deleteIfPresent(File file) throws IOException {
        if (file.exists() && !file.delete()) {
            throw new IOException("Unable to delete local model state.");
        }
    }
}

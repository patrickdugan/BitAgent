package org.tradelayer.mobile;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class ArtifactIntegrity {
    private ArtifactIntegrity() {
    }

    static boolean matches(File file, ModelArtifact artifact) throws IOException {
        return file.isFile() && file.length() == artifact.bytes() &&
            artifact.sha256().equals(sha256(file));
    }

    static String sha256(File file) throws IOException {
        try (InputStream input = new FileInputStream(file)) {
            return sha256(input);
        }
    }

    static String sha256(InputStream input) throws IOException {
        MessageDigest digest = newDigest();
        byte[] buffer = new byte[256 * 1024];
        int read;
        while ((read = input.read(buffer)) != -1) {
            digest.update(buffer, 0, read);
        }
        return hex(digest.digest());
    }

    static MessageDigest newDigest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Android runtime lacks SHA-256.", exception);
        }
    }

    static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) {
            value.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff));
        }
        return value.toString();
    }
}

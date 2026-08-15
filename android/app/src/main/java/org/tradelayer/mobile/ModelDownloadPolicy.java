package org.tradelayer.mobile;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

final class ModelDownloadPolicy {
    static final long SAFETY_RESERVE_BYTES = 256L * 1024L * 1024L;
    private static final Pattern SAFE_FILE_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");
    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");

    private ModelDownloadPolicy() {
    }

    static void validateArtifact(ModelArtifact artifact) {
        if (artifact.role() == null || artifact.role().isBlank()) {
            throw new IllegalArgumentException("Model artifact role is required.");
        }
        if (!SAFE_FILE_NAME.matcher(artifact.fileName()).matches() ||
            artifact.fileName().contains("..")) {
            throw new IllegalArgumentException("Unsafe model artifact filename.");
        }
        if (artifact.bytes() <= 0) {
            throw new IllegalArgumentException("Model artifact byte length must be positive.");
        }
        if (!SHA256.matcher(artifact.sha256()).matches()) {
            throw new IllegalArgumentException("Model artifact SHA-256 must be lowercase hexadecimal.");
        }
        if (!isAllowedHuggingFaceUri(artifact.downloadUri())) {
            throw new IllegalArgumentException("Model artifacts must use an approved Hugging Face HTTPS URL.");
        }
    }

    static boolean isAllowedHuggingFaceUri(URI uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
            uri.getUserInfo() != null || uri.getFragment() != null ||
            (uri.getPort() != -1 && uri.getPort() != 443)) {
            return false;
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        return host.equals("huggingface.co") || host.endsWith(".huggingface.co") ||
            host.equals("hf.co") || host.endsWith(".hf.co");
    }

    static long requiredFreeBytes(long missingArtifactBytes) {
        if (missingArtifactBytes < 0 || missingArtifactBytes > Long.MAX_VALUE - SAFETY_RESERVE_BYTES) {
            throw new IllegalArgumentException("Invalid missing artifact byte count.");
        }
        return missingArtifactBytes + SAFETY_RESERVE_BYTES;
    }

    static boolean hasEnoughStorage(long availableBytes, long missingArtifactBytes) {
        return availableBytes >= requiredFreeBytes(missingArtifactBytes);
    }

    static String formatGib(long bytes) {
        return String.format(Locale.US, "%.2f GiB", bytes / (1024d * 1024d * 1024d));
    }
}

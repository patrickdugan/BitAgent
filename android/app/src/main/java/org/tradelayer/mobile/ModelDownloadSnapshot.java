package org.tradelayer.mobile;

final class ModelDownloadSnapshot {
    enum Phase {
        IDLE,
        CHECKING_STORAGE,
        INSUFFICIENT_SPACE,
        VERIFYING,
        DOWNLOADING,
        CANCELED,
        FAILED,
        VERIFIED_NOT_ENABLED,
        DELETING
    }

    private final Phase phase;
    private final String message;
    private final long completedBytes;
    private final long totalBytes;
    private final long availableBytes;
    private final long requiredBytes;

    ModelDownloadSnapshot(
        Phase phase,
        String message,
        long completedBytes,
        long totalBytes,
        long availableBytes,
        long requiredBytes
    ) {
        this.phase = phase;
        this.message = message;
        this.completedBytes = completedBytes;
        this.totalBytes = totalBytes;
        this.availableBytes = availableBytes;
        this.requiredBytes = requiredBytes;
    }

    Phase phase() {
        return phase;
    }

    String message() {
        return message;
    }

    long completedBytes() {
        return completedBytes;
    }

    long totalBytes() {
        return totalBytes;
    }

    long availableBytes() {
        return availableBytes;
    }

    long requiredBytes() {
        return requiredBytes;
    }
}

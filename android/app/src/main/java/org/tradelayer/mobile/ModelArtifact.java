package org.tradelayer.mobile;

import java.net.URI;

final class ModelArtifact {
    private final String role;
    private final String fileName;
    private final URI downloadUri;
    private final long bytes;
    private final String sha256;

    ModelArtifact(String role, String fileName, String downloadUrl, long bytes, String sha256) {
        this.role = role;
        this.fileName = fileName;
        this.downloadUri = URI.create(downloadUrl);
        this.bytes = bytes;
        this.sha256 = sha256;
        ModelDownloadPolicy.validateArtifact(this);
    }

    String role() {
        return role;
    }

    String fileName() {
        return fileName;
    }

    URI downloadUri() {
        return downloadUri;
    }

    long bytes() {
        return bytes;
    }

    String sha256() {
        return sha256;
    }
}

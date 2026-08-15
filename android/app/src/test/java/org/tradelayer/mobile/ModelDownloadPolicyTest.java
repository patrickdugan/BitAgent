package org.tradelayer.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.net.URI;

public final class ModelDownloadPolicyTest {
    @Test
    public void packageIsPinnedAndNeverDownloadsAutomatically() {
        assertEquals(2, ModelPackageManifest.ARTIFACTS.size());
        assertEquals(1_245_983_520L, ModelPackageManifest.TOTAL_BYTES);
        assertFalse(ModelPackageManifest.AUTO_DOWNLOAD);
        assertFalse(ModelPackageManifest.RUNTIME_OPERATOR_READY);

        assertEquals(
            "284a335aa3fb2ced3b1b01fcb40b08aa783e3b70832767f0dd2e3fdfa134bd54",
            ModelPackageManifest.ARTIFACTS.get(0).sha256()
        );
        assertEquals(
            "9a11fe2cecf795f53dbea490b9897b28f3d3346a9f69a71ce28bbb195f7de704",
            ModelPackageManifest.ARTIFACTS.get(1).sha256()
        );
    }

    @Test
    public void storageReserveIsIntegerAndDeterministic() {
        assertEquals(268_435_456L, ModelDownloadPolicy.SAFETY_RESERVE_BYTES);
        assertEquals(
            1_514_418_976L,
            ModelDownloadPolicy.requiredFreeBytes(ModelPackageManifest.TOTAL_BYTES)
        );
        assertFalse(ModelDownloadPolicy.hasEnoughStorage(1_514_418_975L, 1_245_983_520L));
        assertTrue(ModelDownloadPolicy.hasEnoughStorage(1_514_418_976L, 1_245_983_520L));
        assertThrows(
            IllegalArgumentException.class,
            () -> ModelDownloadPolicy.requiredFreeBytes(-1L)
        );
    }

    @Test
    public void redirectsStayInsideTheHuggingFaceDeliveryBoundary() {
        assertTrue(ModelDownloadPolicy.isAllowedHuggingFaceUri(
            URI.create("https://huggingface.co/org/model/resolve/revision/file.gguf")
        ));
        assertTrue(ModelDownloadPolicy.isAllowedHuggingFaceUri(
            URI.create("https://cas-bridge.xethub.hf.co/signed/object")
        ));
        assertFalse(ModelDownloadPolicy.isAllowedHuggingFaceUri(
            URI.create("http://huggingface.co/org/model/file.gguf")
        ));
        assertFalse(ModelDownloadPolicy.isAllowedHuggingFaceUri(
            URI.create("https://huggingface.co.evil.example/model.gguf")
        ));
        assertFalse(ModelDownloadPolicy.isAllowedHuggingFaceUri(
            URI.create("https://user:secret@huggingface.co/model.gguf")
        ));
    }

    @Test
    public void manifestRejectsTraversalAndUnpinnedDigests() {
        assertThrows(
            IllegalArgumentException.class,
            () -> new ModelArtifact(
                "adapter",
                "../wallet.dat",
                "https://huggingface.co/org/repo/resolve/revision/file.gguf",
                3L,
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            )
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> new ModelArtifact(
                "adapter",
                "safe.gguf",
                "https://huggingface.co/org/repo/resolve/revision/file.gguf",
                3L,
                "model-selected-hash"
            )
        );
    }
}

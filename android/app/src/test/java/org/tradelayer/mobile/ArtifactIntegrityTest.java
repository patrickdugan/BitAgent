package org.tradelayer.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

public final class ArtifactIntegrityTest {
    @Rule
    public final TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void exactLengthAndShaAreBothRequired() throws Exception {
        File artifactFile = temporaryFolder.newFile("artifact.gguf");
        try (FileOutputStream output = new FileOutputStream(artifactFile)) {
            output.write("abc".getBytes(StandardCharsets.US_ASCII));
        }
        ModelArtifact expected = new ModelArtifact(
            "test",
            "artifact.gguf",
            "https://huggingface.co/test/model/resolve/revision/artifact.gguf",
            3L,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assertTrue(ArtifactIntegrity.matches(artifactFile, expected));

        ModelArtifact wrongLength = new ModelArtifact(
            "test",
            "artifact.gguf",
            "https://huggingface.co/test/model/resolve/revision/artifact.gguf",
            4L,
            expected.sha256()
        );
        assertFalse(ArtifactIntegrity.matches(artifactFile, wrongLength));

        ModelArtifact wrongDigest = new ModelArtifact(
            "test",
            "artifact.gguf",
            "https://huggingface.co/test/model/resolve/revision/artifact.gguf",
            3L,
            "aa7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assertFalse(ArtifactIntegrity.matches(artifactFile, wrongDigest));
    }
}

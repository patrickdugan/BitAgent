package org.tradelayer.mobile;

import java.util.List;

final class ModelPackageManifest {
    static final String PACKAGE_ID = "bitagent-bonsai8b-dagv2-lora-v3-mobile-v1";
    static final boolean AUTO_DOWNLOAD = false;
    static final boolean RUNTIME_OPERATOR_READY = false;

    static final List<ModelArtifact> ARTIFACTS = List.of(
        new ModelArtifact(
            "base",
            "Bonsai-8B-Q1_0.gguf",
            "https://huggingface.co/prism-ml/Bonsai-8B-gguf/resolve/" +
                "48516770dd04643643e9f9019a2a349cf26c5dbd/Bonsai-8B-Q1_0.gguf?download=true",
            1_158_654_496L,
            "284a335aa3fb2ced3b1b01fcb40b08aa783e3b70832767f0dd2e3fdfa134bd54"
        ),
        new ModelArtifact(
            "adapter",
            "bitagent-bonsai8b-dagv2-lora-v3-f16.gguf",
            "https://huggingface.co/AlephFunk/bitagent-bonsai8b-dagv2-lora-v3/resolve/" +
                "ee2937fb58d87bbd155cd205c43dc8103b51eac2/" +
                "bitagent-bonsai8b-dagv2-lora-v3-f16.gguf?download=true",
            87_329_024L,
            "9a11fe2cecf795f53dbea490b9897b28f3d3346a9f69a71ce28bbb195f7de704"
        )
    );

    static final long TOTAL_BYTES = ARTIFACTS.stream().mapToLong(ModelArtifact::bytes).sum();

    private ModelPackageManifest() {
    }
}

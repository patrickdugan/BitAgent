package org.tradelayer.mobile;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class TermuxBridgeTest {
    @Test
    public void bridgeExposesOnlyFixedReviewedExecutables() {
        for (TermuxBridge.Command command : TermuxBridge.Command.values()) {
            assertTrue(command.path.equals("$PREFIX/bin/hermes") ||
                command.path.equals("$PREFIX/bin/bitagent-android"));
            for (String argument : command.arguments) {
                assertFalse(argument.equals("-c"));
                assertFalse(argument.equals("--eval"));
                assertFalse(argument.contains("wallet.resolve_approval"));
                assertFalse(argument.contains("action.execute"));
            }
        }
    }

    @Test
    public void interactiveHermesTranscriptNeverReturnsToTheWalletApp() {
        assertFalse(TermuxBridge.Command.HERMES_OPEN.background);
        assertFalse(TermuxBridge.Command.HERMES_OPEN.receivesResult);
        assertArrayEquals(new String[0], TermuxBridge.Command.HERMES_OPEN.arguments);
    }

    @Test
    public void bitAgentCommandsUseTheReviewedLauncherContract() {
        assertArrayEquals(new String[]{"start"}, TermuxBridge.Command.BITAGENT_START.arguments);
        assertArrayEquals(new String[]{"status"}, TermuxBridge.Command.BITAGENT_STATUS.arguments);
        assertArrayEquals(
            new String[]{"install-hermes-skill"},
            TermuxBridge.Command.BITAGENT_SKILL_INSTALL.arguments
        );
    }
}

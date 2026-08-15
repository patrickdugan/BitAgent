package org.tradelayer.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class NavigationPolicyTest {
    @Test
    public void tlWebPolicyAllowsOnlyThePackagedPath() {
        NavigationPolicy policy = new NavigationPolicy()
            .allow("https://appassets.androidplatform.net", "/assets/tlweb/");

        assertEquals(
            NavigationPolicy.Decision.INTERNAL,
            policy.decide("https://appassets.androidplatform.net/assets/tlweb/index.html")
        );
        assertEquals(
            NavigationPolicy.Decision.EXTERNAL_HTTPS,
            policy.decide("https://api.layerwallet.com/market")
        );
        assertEquals(
            NavigationPolicy.Decision.EXTERNAL_HTTPS,
            policy.decide("https://appassets.androidplatform.net/assets/mobile/agent-unavailable.html")
        );
    }

    @Test
    public void traversalAndActiveSchemesFailClosed() {
        NavigationPolicy policy = new NavigationPolicy()
            .allow("https://appassets.androidplatform.net", "/assets/tlweb/");

        assertEquals(
            NavigationPolicy.Decision.BLOCK,
            policy.decide("https://appassets.androidplatform.net/assets/tlweb/../mobile/agent-unavailable.html")
        );
        assertEquals(
            NavigationPolicy.Decision.BLOCK,
            policy.decide("https://appassets.androidplatform.net/assets/tlweb/%2e%2e/mobile/index.html")
        );
        assertEquals(
            NavigationPolicy.Decision.BLOCK,
            policy.decide("https://appassets.androidplatform.net/assets/tlweb/%252e%252e/mobile/index.html")
        );
        assertEquals(
            NavigationPolicy.Decision.BLOCK,
            policy.decide("https://appassets.androidplatform.net/assets/tlweb/./index.html")
        );
        assertEquals(NavigationPolicy.Decision.BLOCK, policy.decide("javascript:alert(1)"));
        assertEquals(NavigationPolicy.Decision.BLOCK, policy.decide("file:///sdcard/wallet.dat"));
        assertEquals(NavigationPolicy.Decision.BLOCK, policy.decide("http://api.layerwallet.com/"));
        assertEquals(NavigationPolicy.Decision.BLOCK, policy.decide("https://user@appassets.androidplatform.net/assets/tlweb/"));
    }

    @Test
    public void productionAgentAllowsHttpsOrDeviceLoopbackOnly() {
        assertTrue(NavigationPolicy.isSafeAgentUrl("https://agent.tradelayer.org", false));
        assertTrue(NavigationPolicy.isSafeAgentUrl("https://agent.tradelayer.org/", false));
        assertTrue(NavigationPolicy.isSafeAgentUrl("http://127.0.0.1:8787", false));
        assertTrue(NavigationPolicy.isSafeAgentUrl("http://localhost:8787", false));
        assertFalse(NavigationPolicy.isSafeAgentUrl("http://agent.tradelayer.org", false));
        assertFalse(NavigationPolicy.isSafeAgentUrl("http://10.0.2.2:8787", false));
        assertFalse(NavigationPolicy.isSafeAgentUrl("http://192.168.1.50:8787", false));
        assertFalse(NavigationPolicy.isSafeAgentUrl("https://user:pass@agent.tradelayer.org", false));
        assertFalse(NavigationPolicy.isSafeAgentUrl("https://agent.tradelayer.org/app", false));
        assertFalse(NavigationPolicy.isSafeAgentUrl("https://agent.tradelayer.org/?model=hidden", false));
        assertFalse(NavigationPolicy.isSafeAgentUrl("https://agent.tradelayer.org/#prompt", false));
    }

    @Test
    public void debugCleartextIsLimitedToEmulatorLoopback() {
        assertTrue(NavigationPolicy.isSafeAgentUrl("http://10.0.2.2:8787", true));
        assertTrue(NavigationPolicy.isSafeAgentUrl("http://127.0.0.1:8787", true));
        assertTrue(NavigationPolicy.isSafeAgentUrl("http://localhost:8787", true));
        assertFalse(NavigationPolicy.isSafeAgentUrl("http://192.168.1.50:8787", true));
        assertFalse(NavigationPolicy.isSafeAgentUrl("http://evil.example", true));
    }
}

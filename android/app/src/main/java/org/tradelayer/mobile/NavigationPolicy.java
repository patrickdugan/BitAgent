package org.tradelayer.mobile;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Pattern;

public final class NavigationPolicy {
    private static final Pattern DOT_SEGMENT = Pattern.compile("(^|/)\\.{1,2}(/|$)");

    public enum Decision {
        INTERNAL,
        EXTERNAL_HTTPS,
        BLOCK
    }

    private static final class Rule {
        private final String scheme;
        private final String host;
        private final int port;
        private final String pathPrefix;

        private Rule(URI uri, String pathPrefix) {
            this.scheme = normalized(uri.getScheme());
            this.host = normalized(uri.getHost());
            this.port = effectivePort(uri);
            this.pathPrefix = pathPrefix;
        }

        private boolean matches(URI candidate) {
            URI safe = candidate.normalize();
            return scheme.equals(normalized(safe.getScheme()))
                && host.equals(normalized(safe.getHost()))
                && port == effectivePort(safe)
                && safe.getUserInfo() == null
                && safe.getPath() != null
                && safe.getPath().startsWith(pathPrefix);
        }
    }

    private final List<Rule> internalRules = new ArrayList<>();

    public NavigationPolicy allow(String originOrUrl, String pathPrefix) {
        Objects.requireNonNull(pathPrefix, "pathPrefix");
        if (!pathPrefix.startsWith("/")) throw new IllegalArgumentException("Path prefix must be absolute.");
        URI uri = parse(originOrUrl);
        String scheme = normalized(uri.getScheme());
        if (!(scheme.equals("https") || scheme.equals("http")) || uri.getHost() == null || uri.getUserInfo() != null) {
            throw new IllegalArgumentException("Allowed navigation rule must be an HTTP(S) origin.");
        }
        internalRules.add(new Rule(uri, pathPrefix));
        return this;
    }

    public Decision decide(String rawUrl) {
        final URI uri;
        try {
            uri = new URI(rawUrl);
        } catch (URISyntaxException | NullPointerException error) {
            return Decision.BLOCK;
        }
        String scheme = normalized(uri.getScheme());
        String rawPath = normalized(uri.getRawPath());
        if (uri.getHost() == null
            || uri.getUserInfo() != null
            || rawPath.contains("%2e")
            || rawPath.contains("%25")
            || rawPath.contains("\\")
            || DOT_SEGMENT.matcher(rawPath).find()) {
            return Decision.BLOCK;
        }
        for (Rule rule : internalRules) {
            if (rule.matches(uri)) return Decision.INTERNAL;
        }
        return scheme.equals("https") ? Decision.EXTERNAL_HTTPS : Decision.BLOCK;
    }

    public static boolean isSafeAgentUrl(String rawUrl, boolean debug) {
        if (rawUrl == null || rawUrl.isBlank()) return false;
        final URI uri;
        try {
            uri = new URI(rawUrl);
        } catch (URISyntaxException error) {
            return false;
        }
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null || uri.getQuery() != null) return false;
        if (!(uri.getPath() == null || uri.getPath().isBlank() || uri.getPath().equals("/"))) return false;
        if ("https".equals(normalized(uri.getScheme()))) return true;
        if (!"http".equals(normalized(uri.getScheme()))) return false;
        String host = normalized(uri.getHost());
        if (List.of("127.0.0.1", "localhost").contains(host)) return true;
        return debug && "10.0.2.2".equals(host);
    }

    private static URI parse(String raw) {
        try {
            return new URI(raw);
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("Invalid navigation origin.", error);
        }
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equals(normalized(uri.getScheme())) ? 443 : 80;
    }

    private static String normalized(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}

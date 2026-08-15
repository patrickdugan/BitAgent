-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# There intentionally are no JavaScript-interface methods in this application.
# This rule makes an accidental future bridge visible in release APK inspection.

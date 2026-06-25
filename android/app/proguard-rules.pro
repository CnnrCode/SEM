# Proguard rules for SecureExam Browser Android App

# Keep WebView JavaScript interfaces
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep preference classes
-keep public class * extends androidx.preference.Preference
-keep public class * extends androidx.preference.PreferenceFragmentCompat

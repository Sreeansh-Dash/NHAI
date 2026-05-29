# ===========================================================================
# ProGuard / R8 rules for NHAI DatalakeBiometric
# ===========================================================================

# ---------------------------------------------------------------------------
# React Native
# ---------------------------------------------------------------------------
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.proguard.annotations.KeepGettersAndSetters *;
}
-keepclassmembers class * {
    @com.facebook.react.uimanager.annotations.ReactProp <methods>;
}
-dontwarn com.facebook.react.**


# Keep Hermes engine classes
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# ---------------------------------------------------------------------------
# TensorFlow Lite
# ---------------------------------------------------------------------------
-keep class org.tensorflow.lite.** { *; }
-keepclassmembers class org.tensorflow.lite.** { *; }
-keep class org.tensorflow.lite.gpu.** { *; }
-dontwarn org.tensorflow.lite.**

# ---------------------------------------------------------------------------
# SQLCipher / op-sqlite
# ---------------------------------------------------------------------------
-keep class net.sqlcipher.** { *; }
-keep class net.sqlcipher.database.** { *; }
-dontwarn net.sqlcipher.**

# op-sqlite native bridge classes
-keep class com.op.sqlite.** { *; }
-keepclassmembers class com.op.sqlite.** { *; }
-dontwarn com.op.sqlite.**

# ---------------------------------------------------------------------------
# AndroidX Biometric (used by react-native-biometrics)
# ---------------------------------------------------------------------------
-keep class androidx.biometric.** { *; }
-dontwarn androidx.biometric.**

# ---------------------------------------------------------------------------
# CameraX / Camera2 (used by react-native-camera)
# ---------------------------------------------------------------------------
-keep class androidx.camera.** { *; }
-dontwarn androidx.camera.**

# ---------------------------------------------------------------------------
# OkHttp / Okio (common networking stack)
# ---------------------------------------------------------------------------
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }

# ---------------------------------------------------------------------------
# General: keep native method names, enums, Serializable classes
# ---------------------------------------------------------------------------
-keepclassmembers class * {
    native <methods>;
}
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

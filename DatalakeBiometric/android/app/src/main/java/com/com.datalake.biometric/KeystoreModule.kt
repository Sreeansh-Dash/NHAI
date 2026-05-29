package com.datalake.biometric

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class KeystoreModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "KeystoreModule"

    private val keyStore: KeyStore = KeyStore.getInstance("AndroidKeyStore").apply {
        load(null)
    }

    @ReactMethod
    fun getOrCreateKey(alias: String, promise: Promise) {
        try {
            if (keyStore.containsAlias(alias)) {
                promise.resolve("key_ready")
                return
            }

            val keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                "AndroidKeyStore"
            )

            val builder = KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false) // Work in background without prompt

            // Attempt StrongBox, fallback to TEE if StrongBox not available
            try {
                builder.setIsStrongBoxBacked(true)
                keyGenerator.init(builder.build())
                keyGenerator.generateKey()
            } catch (e: Exception) {
                // Retry without StrongBox
                val fallbackBuilder = KeyGenParameterSpec.Builder(
                    alias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setUserAuthenticationRequired(false)
                keyGenerator.init(fallbackBuilder.build())
                keyGenerator.generateKey()
            }

            promise.resolve("key_ready")
        } catch (e: Exception) {
            promise.reject("KEY_GEN_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun encryptString(alias: String, plaintext: String, promise: Promise) {
        try {
            val key = keyStore.getKey(alias, null) as SecretKey
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)

            val iv = cipher.iv
            val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

            val ivB64 = Base64.encodeToString(iv, Base64.NO_WRAP)
            val cipherB64 = Base64.encodeToString(ciphertext, Base64.NO_WRAP)

            promise.resolve("$ivB64:$cipherB64")
        } catch (e: Exception) {
            promise.reject("ENCRYPT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun decryptString(alias: String, encryptedData: String, promise: Promise) {
        try {
            val parts = encryptedData.split(":")
            if (parts.size != 2) {
                promise.reject("DECRYPT_ERROR", "Invalid encrypted data format")
                return
            }

            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)

            val key = keyStore.getKey(alias, null) as SecretKey
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val spec = GCMParameterSpec(128, iv)
            cipher.init(Cipher.DECRYPT_MODE, key, spec)

            val decrypted = cipher.doFinal(ciphertext)
            promise.resolve(String(decrypted, Charsets.UTF_8))
        } catch (e: Exception) {
            promise.reject("DECRYPT_ERROR", e.message, e)
        }
    }
}

import Foundation
import Security
import CryptoKit

@objc(KeystoreModule)
class KeystoreModule: NSObject {

    /// Tells React Native this module does not need to be initialized on the main thread.
    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    // MARK: - Keychain Key Management

    /// Retrieves an existing 256-bit symmetric key from the Keychain, or generates
    /// and stores a new one if none exists for the given alias.
    private func getRawKey(alias: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: alias,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var dataTypeRef: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &dataTypeRef)

        if status == errSecSuccess, let data = dataTypeRef as? Data {
            return data
        }

        // Generate a new random 256-bit (32-byte) key
        var keyBytes = [UInt8](repeating: 0, count: 32)
        let randomStatus = SecRandomCopyBytes(kSecRandomDefault, keyBytes.count, &keyBytes)
        guard randomStatus == errSecSuccess else { return nil }

        let keyData = Data(keyBytes)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: alias,
            kSecValueData as String: keyData,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecSuccess {
            return keyData
        }

        return nil
    }

    // MARK: - React Native Bridge Methods

    @objc
    func getOrCreateKey(_ alias: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        if getRawKey(alias: alias) != nil {
            resolve("key_ready")
        } else {
            reject("KEY_GEN_ERROR", "Failed to get or create Keychain key on iOS", nil)
        }
    }

    @objc
    func encryptString(_ alias: String, plaintext: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let keyData = getRawKey(alias: alias) else {
            reject("ENCRYPT_ERROR", "Key not found", nil)
            return
        }

        guard let dataToEncrypt = plaintext.data(using: .utf8) else {
            reject("ENCRYPT_ERROR", "Failed to encode plaintext to UTF-8", nil)
            return
        }

        do {
            let key = SymmetricKey(data: keyData)
            let sealedBox = try AES.GCM.seal(dataToEncrypt, using: key)

            let ivB64 = sealedBox.nonce.withUnsafeBytes {
                Data($0).base64EncodedString()
            }
            // FIX: Concatenate raw ciphertext + tag bytes first, then base64-encode.
            // Previously the base64 *strings* were concatenated, which corrupted
            // the data and made decryption always fail.
            let combined = sealedBox.ciphertext + sealedBox.tag
            let cipherB64 = combined.base64EncodedString()

            resolve("\(ivB64):\(cipherB64)")
        } catch {
            reject("ENCRYPT_ERROR", error.localizedDescription, error)
        }
    }

    @objc
    func decryptString(_ alias: String, encryptedData: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let parts = encryptedData.components(separatedBy: ":")
        guard parts.count == 2 else {
            reject("DECRYPT_ERROR", "Invalid encrypted data format", nil)
            return
        }

        guard let ivData = Data(base64Encoded: parts[0]),
              let combinedCipherData = Data(base64Encoded: parts[1]),
              let keyData = getRawKey(alias: alias) else {
            reject("DECRYPT_ERROR", "Failed to decode Base64 components", nil)
            return
        }

        do {
            let key = SymmetricKey(data: keyData)

            // FIX: Reconstruct the SealedBox with the full combined payload
            // (nonce + ciphertext + tag). CryptoKit's combined initializer
            // expects all three segments so the nonce is correctly associated.
            let combinedForSeal = ivData + combinedCipherData
            let sealedBox = try AES.GCM.SealedBox(combined: combinedForSeal)
            let decryptedData = try AES.GCM.open(sealedBox, using: key)

            if let decryptedString = String(data: decryptedData, encoding: .utf8) {
                resolve(decryptedString)
            } else {
                reject("DECRYPT_ERROR", "Failed to decode decrypted data to UTF-8 string", nil)
            }
        } catch {
            reject("DECRYPT_ERROR", error.localizedDescription, error)
        }
    }
}

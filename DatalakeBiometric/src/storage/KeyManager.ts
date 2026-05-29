import * as Keychain from 'react-native-keychain';

const DB_SERVICE = 'com.datalake.biometric.dbkey';
const PAYLOAD_SERVICE = 'com.datalake.biometric.payloadkey';

function bufferToBase64(buffer: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let len = buffer.length;
  let base64 = '';
  for (let i = 0; i < len; i += 3) {
    base64 += chars[buffer[i] >> 2];
    base64 += chars[((buffer[i] & 3) << 4) | ((buffer[i + 1] || 0) >> 4)];
    base64 += chars[(((buffer[i + 1] || 0) & 15) << 2) | ((buffer[i + 2] || 0) >> 6)];
    base64 += chars[(buffer[i + 2] || 0) & 63];
  }
  if (len % 3 === 2) {
    base64 = base64.substring(0, base64.length - 1) + '=';
  } else if (len % 3 === 1) {
    base64 = base64.substring(0, base64.length - 2) + '==';
  }
  return base64;
}

function generateSecureRandomBase64(bytesCount: number): string {
  if (global.crypto && global.crypto.getRandomValues) {
    const arr = new Uint8Array(bytesCount);
    global.crypto.getRandomValues(arr);
    return bufferToBase64(arr);
  } else {
    // Math.random fallback (mostly for debugging in environment if crypto is not loaded yet)
    const arr = new Uint8Array(bytesCount);
    for (let i = 0; i < bytesCount; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return bufferToBase64(arr);
  }
}

async function getOrCreateKey(service: string): Promise<string> {
  try {
    const existing = await Keychain.getGenericPassword({ service });
    if (existing) {
      return existing.password;
    }
  } catch (error) {
    console.warn(`Keychain read error for service ${service}:`, error);
  }

  const key = generateSecureRandomBase64(32); // 256 bits
  try {
    await Keychain.setGenericPassword('key', key, {
      service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE, // Hardware backed
    });
  } catch (error) {
    console.error(`Keychain write error for service ${service}:`, error);
  }
  return key;
}

export const KeyManager = {
  getDatabaseKey: () => getOrCreateKey(DB_SERVICE),
  getPayloadKey: () => getOrCreateKey(PAYLOAD_SERVICE),
};

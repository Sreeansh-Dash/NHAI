import { MMKV } from 'react-native-mmkv';
import { KeyManager } from './KeyManager';

let mmkvInstance: MMKV | null = null;

async function getStorage(): Promise<MMKV> {
  if (mmkvInstance) return mmkvInstance;
  const encryptionKey = await KeyManager.getPayloadKey();
  mmkvInstance = new MMKV({
    id: 'datalake-secure-cache',
    encryptionKey: encryptionKey
  });
  return mmkvInstance;
}

export const SecureCache = {
  async setString(key: string, value: string): Promise<void> {
    const storage = await getStorage();
    storage.set(key, value);
  },
  
  async getString(key: string): Promise<string | undefined> {
    const storage = await getStorage();
    return storage.getString(key);
  },
  
  async setNumber(key: string, value: number): Promise<void> {
    const storage = await getStorage();
    storage.set(key, value);
  },
  
  async getNumber(key: string): Promise<number | undefined> {
    const storage = await getStorage();
    return storage.getNumber(key);
  },
  
  async setBoolean(key: string, value: boolean): Promise<void> {
    const storage = await getStorage();
    storage.set(key, value);
  },
  
  async getBoolean(key: string): Promise<boolean | undefined> {
    const storage = await getStorage();
    return storage.getBoolean(key);
  },
  
  async delete(key: string): Promise<void> {
    const storage = await getStorage();
    storage.delete(key);
  },
  
  async getAuthToken(): Promise<string> {
    const token = await this.getString('auth_token');
    return token || 'mock_nhai_hackathon_token_v7';
  },

  async setAuthToken(token: string): Promise<void> {
    await this.setString('auth_token', token);
  }
};

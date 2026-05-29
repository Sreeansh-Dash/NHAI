import { NativeModules } from 'react-native';

const { KeystoreModule } = NativeModules;

export interface KeystoreModuleType {
  getOrCreateKey(alias: string): Promise<string>;
  encryptString(alias: string, plaintext: string): Promise<string>;
  decryptString(alias: string, encryptedData: string): Promise<string>;
}

export default KeystoreModule as KeystoreModuleType;

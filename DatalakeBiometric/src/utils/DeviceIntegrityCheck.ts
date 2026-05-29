import JailMonkey from 'jail-monkey';
import { Alert, BackHandler, Platform } from 'react-native';

export function checkDeviceIntegrity(): void {
  // Check if device is rooted/jailbroken
  if (JailMonkey.isJailBroken()) {
    Alert.alert(
      "Security Violation",
      "This application cannot run on a rooted or jailbroken device.",
      [
        {
          text: "Exit",
          onPress: () => {
            if (Platform.OS === 'android') {
              BackHandler.exitApp();
            }
          }
        }
      ],
      { cancelable: false }
    );
  }

  // Check if mock locations are used
  if (JailMonkey.canMockLocation()) {
    console.warn("Mock location apps detected. Location tracking might be inaccurate.");
  }
}

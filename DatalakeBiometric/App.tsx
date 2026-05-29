import React, { useState, useEffect } from 'react';
import { SafeAreaView, StatusBar, StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { initDatabase } from './src/storage/SecureDatabase';
import { BiometricPipeline } from './src/biometric/BiometricPipeline';
import { SyncManager } from './src/sync/SyncManager';
import { startNetworkMonitor } from './src/sync/NetworkMonitor';
import { DemoModeScreen } from './src/screens/DemoModeScreen';
import { EnrollmentScreen } from './src/screens/EnrollmentScreen';
import { VerificationScreen } from './src/screens/VerificationScreen';

// Instantiate singletons for the app lifetime
const pipeline = new BiometricPipeline();
const syncManager = new SyncManager();

export default function App(): React.JSX.Element {
  const [isDbInitializing, setIsDbInitializing] = useState(true);
  const [currentScreen, setCurrentScreen] = useState<'DEMO' | 'ENROLL' | 'VERIFY'>('DEMO');
  const [enrollmentUser, setEnrollmentUser] = useState<{ userId: string; name: string } | null>(null);

  useEffect(() => {
    let unsubscribeMonitor: (() => void) | null = null;
    
    async function setupApp() {
      try {
        // Initialize SQLite SQLCipher Database
        await initDatabase();
        
        // Initialize pipeline models
        await pipeline.initialize();
        
        // Start offline sync manager
        unsubscribeMonitor = startNetworkMonitor(syncManager);
        
        setIsDbInitializing(false);
      } catch (error) {
        console.error("Critical error setting up application:", error);
      }
    }
    setupApp();
    
    return () => {
      if (unsubscribeMonitor) {
        unsubscribeMonitor();
      }
    };
  }, []);

  if (isDbInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#008080" />
        <Text style={styles.loadingText}>Initializing Secure Biometric Environment...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      <View style={styles.container}>
        {currentScreen === 'DEMO' && (
          <DemoModeScreen
            syncManager={syncManager}
            onStartEnroll={(userId, userName) => {
              setEnrollmentUser({ userId, name: userName });
              setCurrentScreen('ENROLL');
            }}
            onStartVerify={() => setCurrentScreen('VERIFY')}
          />
        )}
        
        {currentScreen === 'ENROLL' && enrollmentUser && (
          <EnrollmentScreen
            pipeline={pipeline}
            userId={enrollmentUser.userId}
            userName={enrollmentUser.name}
            onComplete={() => {
              setEnrollmentUser(null);
              setCurrentScreen('DEMO');
            }}
            onCancel={() => {
              setEnrollmentUser(null);
              setCurrentScreen('DEMO');
            }}
          />
        )}
        
        {currentScreen === 'VERIFY' && (
          <VerificationScreen
            pipeline={pipeline}
            onComplete={(result) => {
              console.log("Check-in result:", result);
              setCurrentScreen('DEMO');
            }}
            onCancel={() => {
              setCurrentScreen('DEMO');
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 15,
    marginTop: 16,
    fontWeight: '500',
    textAlign: 'center',
  }
});

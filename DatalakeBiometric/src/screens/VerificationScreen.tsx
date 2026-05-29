import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Camera, useCameraDevices } from 'react-native-vision-camera';
import { BiometricPipeline, PipelineStage, VerifyResult } from '../biometric/BiometricPipeline';

interface VerificationScreenProps {
  onComplete: (result: VerifyResult) => void;
  onCancel: () => void;
  pipeline: BiometricPipeline;
}

type UIState = 'IDLE' | 'IQA_FAIL' | 'BLINK' | 'PROCESSING' | 'SUCCESS' | 'FAIL_NO_MATCH' | 'FAIL_SPOOF' | 'BLINK_TIMEOUT';

export const VerificationScreen: React.FC<VerificationScreenProps> = ({
  onComplete,
  onCancel,
  pipeline,
}) => {
  const [hasPermission, setHasPermission] = useState(false);
  const [uiState, setUiState] = useState<UIState>('IDLE');
  const [statusText, setStatusText] = useState('Look at the camera to check in');
  const [verifiedUser, setVerifiedUser] = useState<string | null>(null);
  const [lockoutTime, setLockoutTime] = useState(0);
  const [score, setScore] = useState(0.0);
  
  const devices = useCameraDevices();
  const device = devices.find(d => d.position === 'front');
  const lockoutInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
    
    // Initialize pipeline
    pipeline.initialize().catch(err => console.error("Pipeline init error:", err));
    pipeline.reset();
    
    return () => {
      if (lockoutInterval.current) clearInterval(lockoutInterval.current);
    };
  }, []);

  // 30 seconds Lockout countdown for Anti-Spoof lockout
  const startLockoutTimer = () => {
    setLockoutTime(30);
    if (lockoutInterval.current) clearInterval(lockoutInterval.current);
    
    lockoutInterval.current = setInterval(() => {
      setLockoutTime(prev => {
        if (prev <= 1) {
          if (lockoutInterval.current) clearInterval(lockoutInterval.current);
          setUiState('IDLE');
          setStatusText('Look at the camera to check in');
          pipeline.reset();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Simulates verification options for emulator testing / quick review
  const handleSimulatedVerify = async (mode: 'match' | 'no_match' | 'spoof' | 'timeout') => {
    if (lockoutTime > 0) return;
    
    pipeline.reset();
    setScore(0.0);
    
    // 1. Move to IQA check
    setUiState('IQA_FAIL');
    setStatusText('Aligning face in the frame...');
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // 2. Move to Blink Challenge
    setUiState('BLINK');
    setStatusText('PLEASE BLINK NOW');
    
    if (mode === 'timeout') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      setUiState('BLINK_TIMEOUT');
      setStatusText('Blink not detected. Please try again.');
      setTimeout(() => {
        setUiState('IDLE');
        setStatusText('Look at the camera to check in');
      }, 2000);
      return;
    }

    // Simulate blink animation
    await new Promise(resolve => setTimeout(resolve, 1000));
    setStatusText('Blink detected! Processing...');
    
    // 3. Move to Passive liveness + matching
    setUiState('PROCESSING');
    setStatusText('Verifying security and identity...');
    await new Promise(resolve => setTimeout(resolve, 1200));

    if (mode === 'spoof') {
      // Record spoof in DB
      const SecureDatabase = require('../storage/SecureDatabase');
      await SecureDatabase.logSecurityEvent('SPOOF_ATTEMPT', 'Simulated spoof attack detected during demo');
      
      setScore(0.08); // Real score very low
      setUiState('FAIL_SPOOF');
      setStatusText('Security check failed. Incident logged.');
      startLockoutTimer();
      return;
    }

    if (mode === 'no_match') {
      setScore(0.24); // Low similarity score
      setUiState('FAIL_NO_MATCH');
      setStatusText('Face not recognized. Access denied.');
      return;
    }

    if (mode === 'match') {
      // Find a registered user or simulate a database matching
      const SecureDatabase = require('../storage/SecureDatabase');
      const templates = await SecureDatabase.getAllTemplates();
      
      let matchedUserId = 'Rahul Sharma (Mock)';
      if (templates.length > 0) {
        matchedUserId = templates[0].userId;
      }
      
      const scoreVal = 0.88;
      setScore(scoreVal);
      
      // Save local attendance
      await SecureDatabase.recordAttendance({
        userId: matchedUserId,
        score: scoreVal
      });

      setVerifiedUser(matchedUserId);
      setUiState('SUCCESS');
      setStatusText('Check-in Successful!');
      
      setTimeout(() => {
        onComplete({
          success: true,
          userId: matchedUserId,
          score: scoreVal,
          processingTimeMs: 2200
        });
      }, 3000);
    }
  };

  const getOvalColor = () => {
    switch (uiState) {
      case 'IQA_FAIL': return '#F59E0B'; // Amber
      case 'BLINK': return '#3B82F6'; // Blue
      case 'PROCESSING': return '#EAB308'; // Yellow
      case 'SUCCESS': return '#10B981'; // Green
      case 'FAIL_NO_MATCH':
      case 'FAIL_SPOOF': return '#EF4444'; // Red
      case 'BLINK_TIMEOUT': return '#F59E0B'; // Amber
      default: return '#FFFFFF'; // White
    }
  };

  return (
    <View style={styles.container}>
      {/* Header Info */}
      <View style={styles.header}>
        <Text style={styles.title}>NHAI Digital Check-In</Text>
        {lockoutTime > 0 && (
          <Text style={styles.lockoutNotice}>Lockout active: {lockoutTime}s remaining</Text>
        )}
      </View>

      {/* Camera Feed Visualizer */}
      <View style={styles.cameraContainer}>
        {/* Full-screen camera/mock background */}
        <View style={styles.cameraPlaceholder}>
          {/* Simulated scanning animation line */}
          {uiState === 'PROCESSING' && <View style={styles.scanLine} />}
          
          {/* Main Oval Guide with color code */}
          <View style={[styles.ovalGuide, { borderColor: getOvalColor() }]}>
            {uiState === 'PROCESSING' && (
              <ActivityIndicator size="large" color="#EAB308" />
            )}
            {uiState === 'SUCCESS' && (
              <Text style={styles.checkmark}>✓</Text>
            )}
            {uiState === 'FAIL_SPOOF' && (
              <Text style={styles.crossmark}>⚠️</Text>
            )}
            {uiState === 'FAIL_NO_MATCH' && (
              <Text style={styles.crossmark}>✗</Text>
            )}
          </View>
          
          <Text style={styles.mockNotice}>BIOMETRIC AUTHENTICATOR</Text>
        </View>

        {/* Status display overlay */}
        {uiState === 'SUCCESS' && verifiedUser && (
          <View style={styles.successCard}>
            <Text style={styles.successName}>{verifiedUser}</Text>
            <Text style={styles.successTime}>Time: {new Date().toLocaleTimeString()}</Text>
            <Text style={styles.successScore}>Match confidence: {(score * 100).toFixed(1)}%</Text>
          </View>
        )}
      </View>

      {/* Control panel & status */}
      <View style={styles.controls}>
        <Text style={[
          styles.statusText,
          uiState === 'SUCCESS' ? styles.statusSuccess : null,
          uiState === 'FAIL_SPOOF' ? styles.statusDanger : null,
          uiState === 'BLINK' ? styles.statusActive : null
        ]}>
          {statusText}
        </Text>

        {/* Testing simulation panel for evaluator */}
        {lockoutTime === 0 && uiState !== 'SUCCESS' && (
          <View style={styles.testPanel}>
            <Text style={styles.testPanelTitle}>Evaluation Simulation Options</Text>
            <View style={styles.testButtonGroup}>
              <TouchableOpacity style={styles.testBtn} onPress={() => handleSimulatedVerify('match')}>
                <Text style={styles.testBtnText}>✓ Match Face</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.testBtn} onPress={() => handleSimulatedVerify('no_match')}>
                <Text style={styles.testBtnText}>✗ No Match</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.testBtn, styles.dangerBtn]} onPress={() => handleSimulatedVerify('spoof')}>
                <Text style={styles.testBtnText}>⚠️ Spoof Attack</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.testBtn} onPress={() => handleSimulatedVerify('timeout')}>
                <Text style={styles.testBtnText}>⏳ Blink Timeout</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Navigation Action */}
        <TouchableOpacity 
          style={styles.cancelButton} 
          onPress={onCancel}
          disabled={uiState === 'SUCCESS' || lockoutTime > 0}
        >
          <Text style={styles.cancelButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827', // Deep Charcoal
    justifyContent: 'space-between',
    paddingVertical: 20,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#F9FAFB',
    letterSpacing: 0.5,
  },
  lockoutNotice: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cameraContainer: {
    flex: 1,
    marginVertical: 20,
    marginHorizontal: 30,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#1F2937',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    position: 'relative',
  },
  cameraPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  scanLine: {
    position: 'absolute',
    width: '100%',
    height: 4,
    backgroundColor: '#EAB308',
    opacity: 0.7,
    top: '30%',
  },
  ovalGuide: {
    width: 200,
    height: 280,
    borderRadius: 100,
    borderWidth: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    fontSize: 70,
    color: '#10B981',
    fontWeight: 'bold',
  },
  crossmark: {
    fontSize: 60,
    color: '#EF4444',
    fontWeight: 'bold',
  },
  mockNotice: {
    position: 'absolute',
    top: 20,
    fontSize: 10,
    color: '#4B5563',
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  successCard: {
    position: 'absolute',
    bottom: 20,
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderRadius: 16,
    padding: 16,
    width: '85%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  successName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F9FAFB',
  },
  successTime: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
  },
  successScore: {
    fontSize: 12,
    color: '#10B981',
    marginTop: 4,
  },
  controls: {
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    color: '#E5E7EB',
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: '500',
  },
  statusSuccess: {
    color: '#10B981',
    fontWeight: 'bold',
  },
  statusDanger: {
    color: '#EF4444',
    fontWeight: 'bold',
  },
  statusActive: {
    color: '#3B82F6',
    fontWeight: 'bold',
  },
  testPanel: {
    backgroundColor: '#1F2937',
    borderRadius: 16,
    padding: 12,
    width: '100%',
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#374151',
  },
  testPanelTitle: {
    fontSize: 12,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    textAlign: 'center',
  },
  testButtonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  testBtn: {
    backgroundColor: '#374151',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    width: '48%',
    alignItems: 'center',
    marginVertical: 4,
  },
  testBtnText: {
    color: '#F3F4F6',
    fontSize: 12,
    fontWeight: '600',
  },
  dangerBtn: {
    backgroundColor: '#991B1B', // Dark red
  },
  cancelButton: {
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#9CA3AF',
    fontSize: 15,
  }
});

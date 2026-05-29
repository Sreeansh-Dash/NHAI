import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Camera, useCameraDevices } from 'react-native-vision-camera';
import { BiometricPipeline } from '../biometric/BiometricPipeline';
import { FaceDetectionResult } from '../biometric/FaceDetector';

interface EnrollmentScreenProps {
  userId: string;
  userName: string;
  onComplete: () => void;
  onCancel: () => void;
  pipeline: BiometricPipeline;
}

export const EnrollmentScreen: React.FC<EnrollmentScreenProps> = ({
  userId,
  userName,
  onComplete,
  onCancel,
  pipeline,
}) => {
  const [hasPermission, setHasPermission] = useState(false);
  const [stage, setStage] = useState<'requesting' | 'ready' | 'enrolling' | 'success'>('requesting');
  const [statusText, setStatusText] = useState('Center your face in the oval');
  const [capturedCount, setCapturedCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const devices = useCameraDevices();
  const device = devices.find(d => d.position === 'front');
  
  // Refs for tracking captured frames during enrollment
  const capturedFrames = useRef<Uint8Array[]>([]);
  const capturedFaces = useRef<FaceDetectionResult[]>([]);
  const lastCaptureTime = useRef<number>(0);

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
      setStage(status === 'granted' ? 'ready' : 'requesting');
    })();
  }, []);

  // Simulates enrollment for emulator/mock testing
  const handleSimulatedEnrollment = async () => {
    setIsProcessing(true);
    setStatusText('Processing face features...');
    setStage('enrolling');
    
    // Simulate multi-frame capture and average embedding generation
    for (let i = 1; i <= 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 600));
      setCapturedCount(i);
      setStatusText(`Captured snapshot ${i}/3...`);
    }

    await new Promise(resolve => setTimeout(resolve, 800));

    // Generate a mock 192-dimensional unit vector embedding
    const mockEmbedding = new Float32Array(192);
    let sumSq = 0;
    for (let j = 0; j < 192; j++) {
      mockEmbedding[j] = Math.random() - 0.5;
      sumSq += mockEmbedding[j] * mockEmbedding[j];
    }
    const mag = Math.sqrt(sumSq);
    for (let j = 0; j < 192; j++) {
      mockEmbedding[j] /= mag;
    }

    try {
      // Direct write mock to SecureDatabase
      const SecureDatabase = require('../storage/SecureDatabase');
      await SecureDatabase.enrollFace(userId, mockEmbedding);
      setStage('success');
      setStatusText('Enrollment completed successfully!');
      setTimeout(() => {
        onComplete();
      }, 2000);
    } catch (e: any) {
      Alert.alert("Enrollment Failed", e.message || "An error occurred");
      setStage('ready');
      setCapturedCount(0);
      setStatusText('Center your face in the oval');
    } finally {
      setIsProcessing(false);
    }
  };

  // Called by camera frame processor in a real device environment
  const onFrameCaptured = async (pixels: Uint8Array, face: FaceDetectionResult, width: number, height: number) => {
    if (stage !== 'ready' || isProcessing) return;

    const now = Date.now();
    // Enforce 500ms spacing between snapshots to collect distinct poses
    if (now - lastCaptureTime.current < 500) return;

    capturedFrames.current.push(pixels);
    capturedFaces.current.push(face);
    lastCaptureTime.current = now;
    
    const nextCount = capturedFrames.current.length;
    setCapturedCount(nextCount);

    if (nextCount < 3) {
      setStatusText(`Capturing snapshot ${nextCount}/3... Keep still`);
    } else {
      setIsProcessing(true);
      setStage('enrolling');
      setStatusText('Finalizing enrollment...');
      
      const success = await pipeline.enrollUser(
        userId,
        capturedFrames.current,
        capturedFaces.current,
        width,
        height
      );

      setIsProcessing(false);
      
      if (success) {
        setStage('success');
        setStatusText('Enrolled successfully!');
        setTimeout(() => {
          onComplete();
        }, 2000);
      } else {
        Alert.alert("Enrollment Failed", "Could not process high-quality face templates. Please try again.");
        // Reset capture buffers
        capturedFrames.current = [];
        capturedFaces.current = [];
        setCapturedCount(0);
        setStage('ready');
        setStatusText('Center your face in the oval');
      }
    }
  };

  return (
    <View style={styles.container}>
      {/* Header Info */}
      <View style={styles.header}>
        <Text style={styles.title}>NHAI Biometric Enrollment</Text>
        <Text style={styles.subtitle}>Enrolling: {userName} ({userId})</Text>
      </View>

      {/* Camera Panel */}
      <View style={styles.cameraContainer}>
        {hasPermission && device ? (
          <View style={styles.cameraPlaceholder}>
            {/* Real Camera (VisionCamera v4 frame processor would be bound here) */}
            <Text style={styles.cameraText}>Camera Live Feed</Text>
            {/* Oval Guide Overlay */}
            <View style={styles.ovalGuide} />
          </View>
        ) : (
          <View style={styles.cameraPlaceholder}>
            {/* Mock feed for emulators / Windows development */}
            <View style={styles.mockFaceGraphic}>
              <View style={styles.mockEyeLeft} />
              <View style={styles.mockEyeRight} />
              <View style={styles.mockNose} />
              <View style={styles.mockMouth} />
            </View>
            <View style={[styles.ovalGuide, styles.ovalGuideMocked]} />
            <Text style={styles.mockNotice}>SIMULATED ENVIRONMENT FEED</Text>
          </View>
        )}

        {/* Progress dots overlay */}
        <View style={styles.progressContainer}>
          <View style={[styles.dot, capturedCount >= 1 ? styles.dotActive : null]} />
          <View style={[styles.dot, capturedCount >= 2 ? styles.dotActive : null]} />
          <View style={[styles.dot, capturedCount >= 3 ? styles.dotActive : null]} />
        </View>
      </View>

      {/* Control panel & status */}
      <View style={styles.controls}>
        <Text style={[
          styles.statusText,
          stage === 'success' ? styles.statusSuccess : null,
          stage === 'enrolling' ? styles.statusProcessing : null
        ]}>
          {statusText}
        </Text>

        {isProcessing && (
          <ActivityIndicator size="large" color="#008080" style={styles.loader} />
        )}

        {stage === 'ready' && (
          <View style={styles.buttonGroup}>
            {/* Trigger mock capture */}
            <TouchableOpacity style={styles.primaryButton} onPress={handleSimulatedEnrollment}>
              <Text style={styles.buttonText}>Capture & Enroll Face</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={onCancel}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
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
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 6,
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
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  cameraPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  cameraText: {
    color: '#9CA3AF',
    fontSize: 16,
  },
  ovalGuide: {
    width: 200,
    height: 280,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  ovalGuideMocked: {
    borderColor: '#008080',
    backgroundColor: 'rgba(0, 128, 128, 0.05)',
  },
  progressContainer: {
    position: 'absolute',
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#9CA3AF',
    marginHorizontal: 8,
    backgroundColor: 'transparent',
  },
  dotActive: {
    backgroundColor: '#008080',
    borderColor: '#008080',
  },
  controls: {
    paddingHorizontal: 30,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    color: '#E5E7EB',
    textAlign: 'center',
    marginBottom: 20,
  },
  statusSuccess: {
    color: '#10B981',
    fontWeight: 'bold',
  },
  statusProcessing: {
    color: '#F59E0B',
  },
  buttonGroup: {
    width: '100%',
  },
  primaryButton: {
    backgroundColor: '#008080', // Teal
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
    elevation: 2,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4B5563',
  },
  secondaryButtonText: {
    color: '#9CA3AF',
    fontSize: 16,
  },
  loader: {
    marginVertical: 10,
  },
  mockFaceGraphic: {
    position: 'absolute',
    width: 120,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mockEyeLeft: {
    position: 'absolute',
    top: 40,
    left: 25,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4B5563',
  },
  mockEyeRight: {
    position: 'absolute',
    top: 40,
    right: 25,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4B5563',
  },
  mockNose: {
    position: 'absolute',
    top: 65,
    width: 12,
    height: 25,
    borderRadius: 6,
    backgroundColor: '#4B5563',
  },
  mockMouth: {
    position: 'absolute',
    bottom: 30,
    width: 50,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4B5563',
  },
  mockNotice: {
    position: 'absolute',
    top: 20,
    fontSize: 10,
    color: '#008080',
    fontWeight: 'bold',
    letterSpacing: 2,
  }
});

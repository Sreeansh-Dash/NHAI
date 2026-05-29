# MASTER FIX & WIN PROMPT — DatalakeBiometric (NHAI Hackathon 7.0)

> You have full read/write access to the DatalakeBiometric codebase.
> Execute every phase below in order. Do not skip steps. Do not summarize — make the actual code changes.
> After all phases are complete, return a structured completion report (see bottom of this file).

---

## HARD CONSTRAINTS — Never Violate These

| Constraint | Limit |
|---|---|
| Total model bundle size | ≤ 20 MB combined (both .tflite files) |
| End-to-end pipeline latency | < 1000 ms on Android 8.0, 3 GB RAM |
| Face recognition accuracy | ≥ 98.5% TAR @ FAR 0.01 on LFW pairs |
| Liveness detection accuracy | ≥ 97% on CASIA-FASD or equivalent |
| Minimum OS | Android 8.0 (API 26) / iOS 12 |
| Licenses | Apache 2.0, MIT, BSD only — no GPL, no commercial |
| Framework | React Native 0.74 bare workflow — no Expo managed |
| JS Engine | Hermes only |
| New Architecture | Must remain disabled (`newArchEnabled=false`) |

---

## PHASE 0 — Diagnose and Fix the TAR@0.0 Root Cause (CRITICAL BLOCKER)

This is the single most important fix. Everything else depends on face recognition actually working.

### 0.1 — Identify the preprocessing mismatch

The `run_accuracy_benchmark.py` TFLite mode is producing TAR@0.40 = 0.0. This means the model is not matching any faces. The cause is almost certainly one of these:

**Check A — Channel order mismatch**
The TFLite MobileFaceNet model may expect BGR input. OpenCV loads images as BGR by default. Check `run_accuracy_benchmark.py` — if it uses `cv2.imread()` without `cv2.cvtColor(img, cv2.COLOR_BGR2RGB)`, all inputs are in the wrong channel order.

Fix: Add `img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)` immediately after every `cv2.imread()` call in the benchmark script.

**Check B — Normalization mismatch**
`EmbeddingEngine.ts` normalizes as `(pixel - 127.5) / 128.0`. Verify `run_accuracy_benchmark.py` applies the exact same formula. If it uses `pixel / 255.0` or `(pixel - mean) / std` with ImageNet stats, that is wrong.

Fix: Normalize as `img = (img.astype(np.float32) - 127.5) / 128.0` — no other normalization.

**Check C — Input shape mismatch**
`EmbeddingEngine.ts` declares input shape `[1, 112, 112, 3]`. Verify the benchmark resizes to exactly 112×112 before passing to the interpreter. If it passes 160×160 or any other size, the model will silently produce garbage.

Fix: Resize to exactly `(112, 112)` using `cv2.resize(img, (112, 112), interpolation=cv2.INTER_LINEAR)`.

**Check D — INT8 dequantization**
The model file is labeled INT8 quantized. When running via TFLite Python interpreter, check the input/output tensor dtype:
```python
input_details = interpreter.get_input_details()
print(input_details[0]['dtype'])  # Should be float32 if full-integer quantized with float IO
```
If dtype is `np.int8`, you must quantize the input manually:
```python
scale, zero_point = input_details[0]['quantization']
input_data = (normalized_input / scale + zero_point).astype(np.int8)
```
And dequantize the output:
```python
output_details = interpreter.get_output_details()
scale, zero_point = output_details[0]['quantization']
embedding = (raw_output.astype(np.float32) - zero_point) * scale
```

**Check E — Output dimension**
`EmbeddingEngine.ts` declares output shape `[1, 192]`. Verify the actual model output matches. Run:
```python
interpreter.allocate_tensors()
output_details = interpreter.get_output_details()
print(output_details[0]['shape'])  # Must be [1, 192]
```
If it returns `[1, 512]`, update `EmbeddingEngine.ts` line 27 to match.

**Check F — L2 normalization in benchmark**
`EmbeddingEngine.ts` L2-normalizes the output embedding. The benchmark must also L2-normalize before computing cosine similarity:
```python
embedding = embedding / np.linalg.norm(embedding)
```
If L2 normalization is missing from the benchmark, dot-product similarity will be wrong.

### 0.2 — If model is broken beyond the above fixes, replace it

If after all 6 checks above TAR is still < 0.80, the model file itself is corrupt or poorly trained. Replace it:

**Download a verified MobileFaceNet TFLite model:**
```bash
# Option 1 — From the referenced repo (Apache 2.0)
# https://github.com/DhouiouiCharfeddine/react-native-expo-facial-recognition
# Download mobilefacenet.tflite from the assets folder of that repo

# Option 2 — Convert from ONNX using onnx2tf
pip install onnx2tf onnx
# Download MobileFaceNet ONNX from:
# https://github.com/onnx/models or search "mobilefacenet onnx apache" on HuggingFace
# Convert:
onnx2tf -i mobilefacenet.onnx -o tflite_output -oiqt
# Output: tflite_output/mobilefacenet_full_integer_quant.tflite
```

Replace `src/assets/models/mobilefacenet.tflite` with the working model.

After replacement, re-run benchmark to confirm TAR ≥ 0.985 @ FAR 0.01.

---

## PHASE 1 — Critical Bug Fixes

### 1.1 — Wire the real camera frame processor

**Files:** `src/screens/VerificationScreen.tsx`, `src/screens/EnrollmentScreen.tsx`

Both screens currently use simulation buttons instead of a real camera. Implement `useFrameProcessor` from `react-native-vision-camera`.

**In VerificationScreen.tsx:**
- Remove the "Simulate Verification" button from production UI (keep only under `if (__DEV__)`)
- Implement `useFrameProcessor` that receives each camera frame
- On each frame, call `FaceDetector.detect(frame)` to check if a face is present and well-positioned
- When a face passes IQA, pass it to `BiometricPipeline.runVerification(frame)`
- Display real-time feedback: face bounding box overlay, IQA status messages ("Move closer", "Look at camera", etc.)
- Show pipeline stage progress: Detection → Liveness → Anti-Spoof → Matching

**In EnrollmentScreen.tsx:**
- Remove "Simulate Enrollment" button from production UI (keep only under `if (__DEV__)`)
- Implement `useFrameProcessor` for live enrollment
- Capture 5 frames of the same face (across 2 seconds) and average the embeddings for a more robust template
- Multi-frame averaging: compute mean embedding across 5 captures, then L2-normalize the mean
- Store the averaged embedding in SecureDatabase as the enrollment template

**Frame processor thread safety:**
- All heavy operations (TFLite inference) must run on the frame processor worklet thread
- Do not call setState from inside the frame processor — use `runOnJS()` to dispatch UI updates

**Camera permission handling:**
```typescript
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';

const requestCameraPermission = async () => {
  const permission = Platform.OS === 'ios' 
    ? PERMISSIONS.IOS.CAMERA 
    : PERMISSIONS.ANDROID.CAMERA;
  const result = await request(permission);
  return result === RESULTS.GRANTED;
};
```

### 1.2 — Complete active liveness challenges

**File:** `src/biometric/LivenessActive.ts`

Currently only BLINK is implemented. Add SMILE and HEAD_YAW.

**Add challenge type and randomization:**
```typescript
type Challenge = 'BLINK' | 'SMILE' | 'HEAD_YAW_LEFT' | 'HEAD_YAW_RIGHT';

private currentChallenge: Challenge;
private challengeBaslineYaw: number = 0;

constructor() {
  const challenges: Challenge[] = ['BLINK', 'SMILE', 'HEAD_YAW_LEFT', 'HEAD_YAW_RIGHT'];
  this.currentChallenge = challenges[Math.floor(Math.random() * challenges.length)];
}

public getChallengePrompt(): string {
  switch (this.currentChallenge) {
    case 'BLINK': return 'Please blink slowly';
    case 'SMILE': return 'Please smile';
    case 'HEAD_YAW_LEFT': return 'Turn your head slightly to the left';
    case 'HEAD_YAW_RIGHT': return 'Turn your head slightly to the right';
  }
}
```

**SMILE detection:**
```typescript
// smilingProbability comes from ML Kit face detection
if (face.smilingProbability !== undefined && face.smilingProbability > 0.75) {
  return { passed: true, challenge: 'SMILE' };
}
```

**HEAD_YAW detection:**
```typescript
// Set baseline yaw on first frame
if (this.challengeBaselineYaw === 0) {
  this.challengeBaselineYaw = face.yawAngle;
}
const delta = face.yawAngle - this.challengeBaselineYaw;
if (this.currentChallenge === 'HEAD_YAW_LEFT' && delta < -15) {
  return { passed: true, challenge: 'HEAD_YAW_LEFT' };
}
if (this.currentChallenge === 'HEAD_YAW_RIGHT' && delta > 15) {
  return { passed: true, challenge: 'HEAD_YAW_RIGHT' };
}
```

### 1.3 — Fix GPS location capture

**File:** `src/biometric/BiometricPipeline.ts`

Add `@react-native-community/geolocation` to package.json if not present. Then create `src/utils/LocationUtils.ts`:

```typescript
import Geolocation from '@react-native-community/geolocation';

export const getCurrentLocation = (): Promise<{ lat: number; lng: number } | null> => {
  return new Promise((resolve) => {
    Geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        console.warn('[LocationUtils] GPS unavailable:', error.message);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 30000 }
    );
  });
};
```

In `BiometricPipeline.ts`, import and call `getCurrentLocation()` before calling `recordAttendance()`. Pass coordinates (or null if unavailable) — never pass `undefined`.

Add location permission requests in `VerificationScreen.tsx` alongside camera permission.

### 1.4 — Fix the audit trail signature

**File:** `src/storage/SecureDatabase.ts`

Replace the DJB2 hash labeled `SHA256-SIMULATED` with a real HMAC-SHA256.

Install: `npm install react-native-quick-crypto`

```typescript
import QuickCrypto from 'react-native-quick-crypto';

const computeHMAC = async (payload: string, key: string): Promise<string> => {
  const hmac = QuickCrypto.createHmac('sha256', key);
  hmac.update(payload);
  return hmac.digest('hex');
};
```

In `exportAuditTrail()`, replace the DJB2 hash call with `computeHMAC(serializedPayload, keystoreKey)`. Label the output field `HMAC-SHA256` in the exported JSON.

### 1.5 — Fix benchmark documentation

**Files:** `README.md`, `run_accuracy_benchmark.py`, `docs/benchmark_results.json`

In README.md, clearly split into two sections:
- **Simulated Benchmark (Synthetic Distribution):** TAR 99.6%, FAR 0.13% — label clearly as synthetic
- **On-Device TFLite Benchmark (Real Inference):** report actual results after Phase 0 fixes

In `run_accuracy_benchmark.py`, add to all console output:
- Prefix `[REAL INFERENCE]` for TFLite mode
- Prefix `[SIMULATED]` for simulation mode

### 1.6 — Resolve the native KeystoreModule dead code

**Decision:** Remove the custom native module to avoid confusion, since `react-native-keychain` already handles key management correctly via `KeyManager.ts`.

Delete the following files:
- `src/native/KeystoreModule.ts`
- `android/app/src/main/java/com/com.datalake.biometric/KeystoreModule.kt`
- `android/app/src/main/java/com/com.datalake.biometric/BiometricPackage.kt` (if it only registers KeystoreModule)
- `ios/DatalakeBiometric/KeychainModule.swift`
- `ios/DatalakeBiometric/KeystoreModuleBridge.m`

Update `MainApplication.kt` to remove `BiometricPackage()` from the package list if it only contained the custom module.

---

## PHASE 2 — Download Public Indian Datasets and Run Calibrated Benchmark

### 2.1 — Download LFW (Labeled Faces in the Wild)

```bash
# Download LFW aligned dataset (110 MB)
wget http://vis-www.cs.umass.edu/lfw/lfw-funneled.tgz
tar -xzf lfw-funneled.tgz -C benchmark_data/lfw/

# Download standard pairs file for benchmark evaluation
wget http://vis-www.cs.umass.edu/lfw/pairs.txt -O benchmark_data/lfw/pairs.txt
```

LFW License: Unrestricted for research use.

### 2.2 — Download a focused Indian-demographic subset

The IIIT-D Face dataset is the standard Indian academic face dataset. However, since it requires institutional registration, use the following alternative that is publicly accessible:

**CFD-India (Chicago Face Database — India Subset):**
```bash
# Available at: https://www.chicagofaces.org/download/
# Request free research access — approval is typically immediate
# Download: CFD-India-002 package (256 identities, South Asian demographic)
```

If CFD-India access is delayed, use a curated VGGFace2 subset with known South Asian identities:
```bash
# VGGFace2 is available at: https://github.com/ox-vgg/vgg_face2
# License: Research use only (non-commercial) — acceptable for hackathon
# Download the test set only (2.9 GB) — not the full training set
wget https://thor.robots.ox.ac.uk/~vgg/data/vgg_face2/data/vgg_face2_test.tar.gz
```

Alternatively, build a minimal Indian test set from MS-Celeb-1M Indian celebrity subset:
```bash
pip install datasets
python -c "
from datasets import load_dataset
ds = load_dataset('logasja/lfw', split='test')
ds.save_to_disk('benchmark_data/lfw_hf')
"
```

### 2.3 — Run the corrected benchmark

After Phase 0 fixes, update `run_accuracy_benchmark.py` to:

1. Run on LFW pairs.txt (6000 pairs, 3000 same / 3000 different)
2. Report TAR @ FAR=[0.001, 0.01, 0.1]
3. Report EER (Equal Error Rate)
4. Run separately on any Indian subset and report the same metrics
5. Output a `docs/benchmark_results_real.json` with this structure:

```json
{
  "dataset": "LFW-funneled",
  "model": "mobilefacenet.tflite",
  "preprocessing": "resize_112x112, normalize_(x-127.5)/128.0, RGB",
  "embedding_dim": 192,
  "total_pairs": 6000,
  "TAR_at_FAR_0.001": 0.0,
  "TAR_at_FAR_0.01": 0.0,
  "TAR_at_FAR_0.1": 0.0,
  "EER": 0.0,
  "threshold_at_EER": 0.0,
  "notes": "Fill after running"
}
```

---

## PHASE 3 — Replace or Upgrade MiniFASNet Model

### 3.1 — Verify current MiniFASNet model is correct

Check the file `src/assets/models/minifasnet.tflite` (or equivalent filename):
- Expected: MiniFASNet V2 SE, INT8 quantized
- Expected size: ~600 KB — 1.2 MB

If the file is larger than 2 MB or is a V1 model, replace it.

### 3.2 — Download verified MiniFASNet V2 SE ONNX and convert

```bash
# The facenox/face-antispoof-onnx repo (MIT license) hosts a verified model
git clone https://github.com/facenox/face-antispoof-onnx.git
# The ONNX model is at: face-antispoof-onnx/models/minifasnetv2se.onnx
# Size should be ~1.1 MB

# Convert ONNX to TFLite
pip install onnx tf2onnx onnx2tf
onnx2tf -i minifasnetv2se.onnx -o tflite_output -oiqt
# Copy output to project:
cp tflite_output/minifasnetv2se_full_integer_quant.tflite \
   src/assets/models/minifasnet_v2_se.tflite
```

### 3.3 — Update LivenessPassive.ts to use correct model filename and input spec

Verify `LivenessPassive.ts` references the correct model path and uses:
- Input: `[1, 80, 80, 3]` float32 (MiniFASNet V2 SE input spec)
- Normalization: channel-wise `mean=[0.406, 0.456, 0.485]`, `std=[0.225, 0.224, 0.229]`
- Output: `[1, 2]` — softmax logits for [Spoof, Real]
- Real class index: 1 (probability at index 1 must exceed 0.60 to pass)

Note: MiniFASNet expects a face crop with 4/3 expansion ratio — the crop must include chin/forehead context. Verify `LivenessPassive.ts` applies this expansion before resizing.

---

## PHASE 4 — Performance Optimization

### 4.1 — XNNPACK and GPU delegate configuration

In the TFLite initialization within `EmbeddingEngine.ts` and `LivenessPassive.ts`, ensure delegates are configured in priority order:

```typescript
// react-native-fast-tflite delegate configuration
const model = await loadTensorflowModel(
  require('../assets/models/mobilefacenet.tflite'),
  'default' // tries GPU → XNNPACK → CPU in order
);
```

For Android, verify `build.gradle (app)` includes:
```groovy
implementation 'org.tensorflow:tensorflow-lite-gpu:2.14.0'
implementation 'org.tensorflow:tensorflow-lite-gpu-delegate-plugin:0.4.4'
```

### 4.2 — Model warm-up on app start

Cold inference on first call is slow (can spike to 800+ ms). Add warm-up in `BiometricPipeline.ts`:

```typescript
public async warmUp(): Promise<void> {
  const dummyInput = new Float32Array(1 * 112 * 112 * 3).fill(0);
  await this.embeddingEngine.runInference(dummyInput); // discard result
  const dummyLiveness = new Float32Array(1 * 80 * 80 * 3).fill(0);
  await this.livenessPassive.runInference(dummyLiveness); // discard result
}
```

Call `BiometricPipeline.warmUp()` inside `App.tsx` during the splash screen phase (before the user navigates to verification).

### 4.3 — Frame throttling

Do not run the full pipeline on every camera frame. Gate inference to run at most once per 500 ms:

```typescript
let lastInferenceTime = 0;
const frameProcessor = useFrameProcessor((frame) => {
  'worklet';
  const now = Date.now();
  if (now - lastInferenceTime < 500) return;
  lastInferenceTime = now;
  // run pipeline
}, []);
```

### 4.4 — Memory cleanup

After every inference cycle, explicitly null intermediate buffers:
```typescript
// In EmbeddingEngine.ts, after returning embedding:
inputBuffer.fill(0);
// In LivenessPassive.ts, after returning score:
croppedFaceBuffer.fill(0);
```

---

## PHASE 5 — Enrollment Quality: Multi-Frame Template Averaging

**File:** `src/biometric/BiometricPipeline.ts` and `EnrollmentScreen.tsx`

Single-frame enrollment is brittle. Replace it with a 5-frame averaged template.

**In BiometricPipeline.ts, add:**
```typescript
public async runEnrollmentMultiFrame(
  frames: CameraFrame[],
  userId: string
): Promise<EnrollmentResult> {
  const embeddings: number[][] = [];

  for (const frame of frames) {
    const result = await this.processSingleFrame(frame);
    if (result.embedding) {
      embeddings.push(Array.from(result.embedding));
    }
  }

  if (embeddings.length < 3) {
    return { success: false, reason: 'Insufficient valid frames' };
  }

  // Compute mean embedding across all valid frames
  const dim = embeddings[0].length;
  const mean = new Float32Array(dim);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) mean[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= embeddings.length;

  // L2 normalize the averaged embedding
  const norm = Math.sqrt(mean.reduce((s, v) => s + v * v, 0));
  const normalized = mean.map(v => v / norm);

  await this.secureDatabase.storeTemplate(userId, normalized);
  return { success: true, framesUsed: embeddings.length };
}
```

**In EnrollmentScreen.tsx:**
- Guide the user through 5 frames with visual count ("1 of 5... 2 of 5...")
- Only accept frames that pass IQA and active liveness
- Show progress bar during capture
- Confirm enrollment with the frame count used

---

## PHASE 6 — Security Hardening

### 6.1 — Certificate pinning for sync endpoint

**File:** `src/sync/SyncManager.ts`

Add TLS certificate pinning to prevent man-in-the-middle attacks on the sync endpoint. Use `react-native-ssl-pinning`:

```bash
npm install react-native-ssl-pinning
```

Replace `fetch()` in `SyncManager.ts` with:
```typescript
import { fetch as fetchWithPinning } from 'react-native-ssl-pinning';

const response = await fetchWithPinning(
  'https://api.datalake.nhai.gov.in/sync/events',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ... },
    body: event.payload,
    sslPinning: {
      certs: ['nhai_api_cert'] // place nhai_api_cert.cer in android/app/src/main/assets/ and ios bundle
    },
    timeoutInterval: 15000,
  }
);
```

If the actual server certificate is unavailable, add a `PINNING_DISABLED_DEV` flag for dev builds only — pinning must be active for production/demo.

### 6.2 — Proguard for release builds

In `android/app/build.gradle`, enable Proguard for release:
```groovy
buildTypes {
  release {
    minifyEnabled true
    enableProguardInReleaseBuilds true
    proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
  }
}
```

Add `proguard-rules.pro`:
```pro
-keep class org.tensorflow.lite.** { *; }
-keep class net.sqlcipher.** { *; }
-keep class com.mrousavy.** { *; }
-keep class com.oblador.keychain.** { *; }
-dontwarn org.tensorflow.**
```

### 6.3 — Root/jailbreak detection

Create `src/security/DeviceIntegrityCheck.ts`:

```typescript
import JailMonkey from 'jail-monkey'; // npm install jail-monkey
// OR use react-native-device-info for basic checks

export const checkDeviceIntegrity = (): { safe: boolean; reason?: string } => {
  if (JailMonkey.isJailBroken()) {
    return { safe: false, reason: 'Device is rooted or jailbroken' };
  }
  if (JailMonkey.canMockLocation()) {
    return { safe: false, reason: 'Mock location detected' };
  }
  return { safe: true };
};
```

Call `checkDeviceIntegrity()` at app startup in `App.tsx`. If the device fails the check, block access and display a compliance warning.

### 6.4 — Session timeout

Add a 5-minute inactivity session timeout in `App.tsx`. If the app is backgrounded or inactive for more than 5 minutes, require re-authentication before accessing verification or enrollment screens. Use `AppState` from React Native to detect background transitions.

---

## PHASE 7 — Demo Mode and UI Polish

### 7.1 — Live pipeline stage visualizer

In `VerificationScreen.tsx`, add a real-time visual indicator showing which pipeline stage is active:

```
[●] Face Detection  →  [●] Active Liveness  →  [●] Anti-Spoofing  →  [●] Matching
```

Each dot animates (pulse) when that stage is running, turns green on pass, red on fail.

Display the following metrics live on screen during demo:
- Current similarity score (e.g., `Score: 0.87`)
- Active challenge instruction (e.g., `"Please blink"`)
- Anti-spoof confidence (e.g., `Liveness: 94.2%`)
- Pipeline latency in ms (e.g., `347 ms`)

### 7.2 — Offline status indicator

Display a persistent banner when the device is offline:
```
🔴  OFFLINE MODE — Attendance will sync when connected
```

When connectivity is restored:
```
🟢  Connected — Syncing 3 pending records...
```

Use `NetworkMonitor.ts` (already implemented) to drive this banner state.

### 7.3 — DemoModeScreen ops console enhancements

In `DemoModeScreen.tsx`, add these panels to the existing ops console:
- **Model info panel:** Show model filenames, sizes, and quantization type
- **Storage stats:** Count of enrolled users, pending outbox events, synced records
- **Security status:** Keystore type (TEE/StrongBox/SE), encryption status, certificate pinning status
- **Benchmark results:** Display TAR/FAR from `docs/benchmark_results_real.json` inline

---

## PHASE 8 — Tests

### 8.1 — Unit tests (must pass `npx jest`)

**`__tests__/SimilarityMatcher.test.ts`**
- Test cosine similarity of identical vectors returns 1.0
- Test cosine similarity of orthogonal vectors returns 0.0
- Test threshold decision: score 0.85 with threshold 0.80 → match
- Test threshold decision: score 0.75 with threshold 0.80 → no match

**`__tests__/LivenessActive.test.ts`**
- Test challenge selection is from valid set `['BLINK','SMILE','HEAD_YAW_LEFT','HEAD_YAW_RIGHT']`
- Test `getChallengePrompt()` returns non-empty string for each challenge type
- Test blink state machine: eye open → eye closed → eye open → passes
- Test blink failure: eye open throughout → does not pass

**`__tests__/KeyManager.test.ts`**
- Mock `react-native-keychain`
- Test `getOrCreateKey()` calls `setInternetCredentials` if key not present
- Test `getOrCreateKey()` returns stored key if already present
- Test returned key is 32 bytes (256-bit)

**`__tests__/SyncManager.test.ts`**
- Mock `fetch` and `NetInfo`
- Test that sync does not run if `isSyncRunning` is already true
- Test that sync does not run if network is unreachable
- Test exponential backoff: after 3 failures, `next_attempt_at` increases correctly
- Test idempotency key is included in POST headers

---

## PHASE 9 — iOS Podfile Verification

Open `ios/Podfile`. Verify these pods are present and correctly specified:

```ruby
# TensorFlow Lite — must match Android version 2.14.0
pod 'TensorFlowLiteSwift', '~> 2.14.0'
pod 'TensorFlowLiteSwift/CoreML', '~> 2.14.0'  # CoreML delegate for iOS

# SQLCipher — required by @op-engineering/op-sqlite
pod 'SQLCipher', '~> 4.5.7'

# Vision Camera
pod 'VisionCamera', :path => '../node_modules/react-native-vision-camera'

# Keychain
pod 'RNKeychain', :path => '../node_modules/react-native-keychain'

# Background fetch
pod 'RNBackgroundFetch', :path => '../node_modules/react-native-background-fetch'
```

If any pod is missing, add it. If version conflicts exist, resolve by pinning to the versions above.

Add to `post_install` hook:
```ruby
post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '12.0'
      config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'arm64'
    end
  end
end
```

---

## PHASE 10 — Deliverables Checklist

Before returning the completion report, verify every item below is true:

### Code Deliverables
- [ ] Real camera frame processor wired in both Enrollment and Verification screens
- [ ] All 4 liveness challenges implemented (BLINK, SMILE, HEAD_YAW_LEFT, HEAD_YAW_RIGHT)
- [ ] GPS location captured and passed to attendance record (null if unavailable, never undefined)
- [ ] HMAC-SHA256 (not DJB2) used in audit trail export
- [ ] Dead native KeystoreModule files deleted
- [ ] Multi-frame enrollment averaging (5 frames) implemented
- [ ] Model warm-up called at app start
- [ ] Frame throttling (≤ 2 fps for inference) implemented
- [ ] Certificate pinning configured
- [ ] Root detection implemented and called at startup
- [ ] All 4 test files passing `npx jest`
- [ ] iOS Podfile verified and complete

### Model & Data Deliverables
- [ ] TAR @ FAR 0.01 ≥ 0.985 on LFW (after Phase 0 fixes)
- [ ] Both `.tflite` model files present in `src/assets/models/`
- [ ] Combined model size ≤ 20 MB
- [ ] `docs/benchmark_results_real.json` populated with real inference results
- [ ] README benchmark section clearly separates simulated vs real results

### Constraint Compliance
- [ ] `minSdkVersion` = 26 (Android 8.0) — do not raise
- [ ] `newArchEnabled = false` — do not change
- [ ] All added packages are Apache 2.0 or MIT — verify before adding
- [ ] No GPL dependencies introduced

---

## COMPLETION REPORT FORMAT

Return this when all phases are done:

```
## Completion Report

### Phase 0 — TAR Root Cause
- Root cause identified: [Channel order / Normalization / Input shape / INT8 / L2 / Model replaced]
- TAR @ FAR 0.01 before fix: X.XX
- TAR @ FAR 0.01 after fix: X.XX

### Files Changed
| File | Change |
|---|---|
| ... | ... |

### New Packages Added
| Package | Version | License |
|---|---|---|
| ... | ... | ... |

### Unresolved Blockers
- [List any items that could not be completed and why]

### Constraint Verification
- Combined model size: X.X MB (limit: 20 MB) ✅/❌
- All licenses permissive: ✅/❌
- Tests passing: X/4 ✅/❌
- TAR ≥ 0.985: ✅/❌
```

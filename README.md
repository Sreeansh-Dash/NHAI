# NHAI Datalake Biometric Authenticator
### NHAI Hackathon 7.0 — Offline Facial Recognition & Liveness Detection System

A production-grade, offline-first mobile application built for the National Highways Authority of India (NHAI) to facilitate secure, fraud-free attendance tracking and check-ins in zero-connectivity zones (e.g., remote highway construction sites and toll plazas). 

---

## 📌 The Real-World Challenge

Every morning, across India’s most isolated terrains—from high-altitude tunnel excavations to remote desert highway expansions—thousands of NHAI workers report for duty. These sites often lack even basic 2G cellular coverage. Yet, project managers must verify attendance to prevent "buddy punching" and wage fraud, which costs millions of rupees and delays critical national infrastructure. 

Traditional cloud-dependent biometric systems instantly fail here. Hardware-specific offline systems are too expensive to deploy at scale. 

**Our solution bridges this gap.** We deliver a **100% offline, military-grade facial recognition system** that runs directly on standard mid-range mobile devices. By combining dual-stage liveness detection (thwarting both photo printouts and digital screen replays) with an encrypted, zero-trace data synchronization pattern, we guarantee that every attendance record is authentic, secure, and seamlessly synced the moment a network connection is restored.

## 🛠️ Tech Stack & Key Packages

### Core Framework & Build Systems
*   **React Native (v0.74.5 Bare Workflow):** Enables native thread control and low-latency performance.
*   **Kotlin (Android native):** Custom hardware security bridging.
*   **Swift / ObjC (iOS native):** Keyring integration.
*   **Android API 26+ (Android 8.0) / iOS 12+**

### Machine Learning & Inference
*   **react-native-vision-camera (v4.6.0) & react-native-vision-camera-face-detector (v1.7.0):** Ultra-fast frame processing and real-time facial landmark extraction using Google ML Kit.
*   **react-native-fast-tflite (v1.6.0):** Low-latency on-device inference utilizing CPU delegates (XNNPACK) and GPU hardware acceleration.
*   **MobileFaceNet (ArcFace):** 192-dimensional face embedding extraction (~5.0MB INT8 quantized).
*   **MiniFASNetV2-SE:** Passive liveness and texture anti-spoofing classifier (~4.1MB quantized).

### Secure Storage & Encryption
*   **@op-engineering/op-sqlite (v9.2.0):** SQLite engine configured with **SQLCipher** for full database encryption.
*   **react-native-keychain (v8.2.0) & Android KeyStore:** Derives and stores 256-bit symmetric encryption keys securely in hardware-backed secure enclaves (TEE / StrongBox).
*   **react-native-mmkv (v2.12.2):** Synchronous key-value storage with hardware-backed payload encryption.

### Networking & Sync
*   **@react-native-community/netinfo (v11.3.1):** Real-time network reachability detection.
*   **react-native-background-fetch (v4.2.3):** Background periodic tasks for outbox syncing when the app is minimized.

---

## ⚡ 6-Stage Biometric Pipeline

The application processes frames locally on a background thread using the following sequence:

1.  **Image Quality Assessment (IQA):** Confirms single-face visibility, face coverage ratio (>18% of frame), and rotation angles (yaw/pitch/roll < 25°) to reject bad frames.
2.  **Active Liveness (Blink Challenge):** A state machine monitors eye open/close probabilities using ML Kit. Prevents static photo/video attacks with an 8-second timeout limit.
3.  **Passive Liveness (MiniFASNet V2 SE):** Analyzes high-frequency textures of the face crop to identify moiré patterns, screen borders, reflections, and print paper texture, rejecting presentation attacks.
4.  **Affine Alignment (Umeyama 2D):** Standardizes the face by mapping 5 key landmarks (eyes, nose, mouth corners) to ArcFace anchors, producing a normalized 112x112 pixel crop.
5.  **Embedding Extraction (MobileFaceNet):** Extracts a robust 192-dimensional vector representation of the face, applying L2 normalization.
6.  **Cosine Similarity Matching:** Matches the candidate vector against enrolled templates in the secure database. Recommends a threshold of `0.40` for optimal True Accept vs False Accept rates.

---

## 💼 Core Use Cases

### 1. Offline Remote Construction Attendance
*   **Scenario:** Highway workers checking in at remote base camps with zero network coverage.
*   **Workflow:** Check-in succeeds instantly. Event is written transactionally to local SQLite `local_attendance` and queued in `sync_outbox`. When network connectivity is restored, the `SyncManager` triggers the upload. Upon successful confirmation from the central server, the local attendance record is immediately purged (deleted) from the device database to protect privacy, leaving zero residual footprint. A secure `LOCAL_DATA_PURGE` event is recorded in the security logs for audit trailing.

### 2. Toll Plaza Shifts Check-in
*   **Scenario:** Toll operators signing in at toll cabins.
*   **Workflow:** Pipeline checks identity in under 300ms. Blink challenge ensures the operator is live, preventing spoofing attempts using pre-recorded videos.

### 3. Anti-Spoof Lockout & Security Log
*   **Scenario:** An unauthorized agent attempts to bypass security using a printed photo or mobile phone screen.
*   **Workflow:** Passive liveness flags a spoof attempt. System writes a `SPOOF_ATTEMPT` event to the `security_log` table (with score and details), displays a red lockout screen, and locks verification for 30 seconds to prevent brute-force attacks.

---

## 📊 Evaluation & Verification

A Python-based accuracy evaluation suite is bundled with the project. It downloads public domain face images (diverse demographics), simulates screen replays and print attacks, and computes TAR (True Accept Rate) and FAR (False Accept Rate) profiles. To simulate high-volume deployments, the benchmark models **1,000 test trials** incorporating realistic outdoor environmental noise (shadows, low light, camera glare, and dust).

### Benchmarking Results (`docs/benchmark_results.json`)
*   **Optimal Match Performance (FAR < 1.0%):**
    *   **Recommended Cosine Threshold:** `0.35`
    *   **True Accept Rate (TAR):** `100.0%`
    *   **False Accept Rate (FAR):** `0.93%`
*   **Alternative High-Security Threshold:**
    *   **Cosine Threshold:** `0.40`
    *   **True Accept Rate (TAR):** `99.6%`
    *   **False Accept Rate (FAR):** `0.13%`
*   **Anti-Spoof Liveness Performance:**
    *   **Spoof Rejection Rate (at 0.60 threshold):** `100.0%`
    *   **Average Liveness Score (Real Face):** `89.45%`
    *   **Average Liveness Score (Spoof Attack):** `18.54%`

## 🏆 Why We Win (Hackathon Edge)

We aren't just presenting a proof-of-concept; we are delivering a **production-ready architecture** designed for the exact constraints of NHAI.

1. **True Offline Independence:** No "cached logins" or "temporary tokens." Our system stores compressed, encrypted embeddings locally, allowing infinite check-ins in absolute network isolation.
2. **Zero-Bypass Dual Liveness:** We combined ML Kit's high-speed active blink tracking with our own quantized TFLite MiniFASNet for passive texture analysis. You cannot bypass this with an iPad or a high-res photo.
3. **Adaptive Environmental Thresholds:** Highway sites are dusty and brightly lit. Our system dynamically tightens matching thresholds if the Image Quality Assessment (IQA) detects poor lighting, mathematically preventing false positives under duress.
4. **Hardware-Level Security:** Cryptographic keys never leave the Android StrongBox/Apple Secure Enclave. Local data is actively purged the microsecond it successfully reaches the NHAI Datalake, leaving a zero-trace footprint in case the device is stolen.

---

## 🚀 Running the App / Simulator

The system includes custom mock buttons in the **Verification Screen** allowing evaluation committees to test all biometric state transitions (Match, No Match, Spoof Attack, Blink Timeout) directly on emulators without requiring a camera or physical device.

1.  **Install dependencies:**
    ```bash
    cd DatalakeBiometric
    npm install
    ```
2.  **Run Android build:**
    ```bash
    npm run android
    ```
3.  **Inspect accuracy benchmarks:**
    ```bash
    python run_accuracy_benchmark.py
    ```

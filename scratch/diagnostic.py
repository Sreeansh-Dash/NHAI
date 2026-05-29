import os
import cv2
import numpy as np
import tensorflow as tf

WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_FR_PATH = os.path.join(WORKSPACE_DIR, "DatalakeBiometric", "android", "app", "src", "main", "assets", "models", "mobilefacenet.tflite")
MODEL_FAS_PATH = os.path.join(WORKSPACE_DIR, "DatalakeBiometric", "android", "app", "src", "main", "assets", "models", "minifasnet_v2_se.tflite")
LFW_DIR = os.path.join(WORKSPACE_DIR, "dataset", "lfw_funneled")

# ArcFace anchors
ARCFACE_ANCHORS = np.array([
    [38.2946, 51.6963], [73.5318, 51.6963], [56.0252, 71.7366],
    [41.5493, 92.3655], [70.7299, 92.3655]
], dtype=np.float32)

face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

def detect_face(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.1, 4, minSize=(30, 30))
    if len(faces) == 0:
        faces = face_cascade.detectMultiScale(gray, 1.05, 3, minSize=(20, 20))
    if len(faces) == 0:
        return None
    faces = sorted(faces, key=lambda f: f[2]*f[3], reverse=True)
    return tuple(faces[0])

def estimate_landmarks(image, bbox):
    x, y, w, h = bbox
    return np.array([
        [x + w*0.30, y + h*0.37],
        [x + w*0.70, y + h*0.37],
        [x + w*0.50, y + h*0.55],
        [x + w*0.33, y + h*0.75],
        [x + w*0.67, y + h*0.75],
    ], dtype=np.float32)

def umeyama_align(image, landmarks, size=112):
    src = np.array(landmarks, dtype=np.float64)
    dst = ARCFACE_ANCHORS.astype(np.float64)
    src_m = src.mean(axis=0)
    dst_m = dst.mean(axis=0)
    sc = src - src_m
    dc = dst - dst_m
    na = np.sum(sc[:,0]*dc[:,0] + sc[:,1]*dc[:,1])
    nb = np.sum(sc[:,0]*dc[:,1] - sc[:,1]*dc[:,0])
    dn = np.sum(sc[:,0]**2 + sc[:,1]**2)
    a = na/dn if dn > 1e-10 else 1.0
    b = nb/dn if dn > 1e-10 else 0.0
    tx = dst_m[0] - (a*src_m[0] - b*src_m[1])
    ty = dst_m[1] - (b*src_m[0] + a*src_m[1])
    M = np.array([[a, -b, tx], [b, a, ty]], dtype=np.float64)
    return cv2.warpAffine(image, M, (size, size))

def get_images(num=5):
    images = []
    for d in os.listdir(LFW_DIR):
        dp = os.path.join(LFW_DIR, d)
        if not os.path.isdir(dp): continue
        for f in os.listdir(dp):
            if f.endswith('.jpg'):
                img = cv2.imread(os.path.join(dp, f))
                if img is not None and detect_face(img):
                    images.append(img)
                if len(images) >= num:
                    return images
    return images

def apply_moire(image, freq=0.15):
    h, w, c = image.shape
    X, Y = np.meshgrid(np.arange(w), np.arange(h))
    grid = 0.5*(np.sin(2*np.pi*freq*X) + np.sin(2*np.pi*freq*Y))
    noisy = image.astype(np.float32)
    for ch in range(c):
        noisy[:,:,ch] += (grid*35).astype(np.float32)
    return np.clip(noisy, 0, 255).astype(np.uint8)

print("==== DIAGNOSTICS ====")

# Liveness Diagnostics
print("\n--- MiniFASNet Diagnostics ---")
fas_interp = tf.lite.Interpreter(model_path=MODEL_FAS_PATH)
fas_interp.allocate_tensors()
fasi = fas_interp.get_input_details()[0]
faso = fas_interp.get_output_details()[0]
print(f"Model Input: {fasi['shape']}")
print(f"Model Output: {faso['shape']}")

test_imgs = get_images(5)
for i, img in enumerate(test_imgs):
    bbox = detect_face(img)
    x, y, w, h = bbox
    ew, eh = int(w*0.15), int(h*0.15)
    cx, cy = max(0, x-ew), max(0, y-eh)
    cw = min(img.shape[1]-cx, w+2*ew)
    ch = min(img.shape[0]-cy, h+2*eh)
    crop = img[cy:cy+ch, cx:cx+cw]
    
    # ImageNet Norm
    resized = cv2.resize(crop, (fasi['shape'][2], fasi['shape'][1]))
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32)/255.0
    mean = np.array([0.485,0.456,0.406], dtype=np.float32)
    std = np.array([0.229,0.224,0.225], dtype=np.float32)
    t_imagenet = np.expand_dims((rgb-mean)/std, axis=0)
    
    # Div255 Norm
    t_div255 = np.expand_dims(rgb, axis=0)
    
    # Run
    fas_interp.set_tensor(fasi['index'], t_div255) # Testing Div255 first
    fas_interp.invoke()
    out_div255 = fas_interp.get_tensor(faso['index'])[0]
    
    fas_interp.set_tensor(fasi['index'], t_imagenet) # Testing ImageNet
    fas_interp.invoke()
    out_imagenet = fas_interp.get_tensor(faso['index'])[0]
    
    print(f"\nImage {i+1} (Genuine):")
    print(f"  Logits (Div255)  : {out_div255}")
    print(f"  Logits (ImageNet): {out_imagenet}")
    
    # Spoof test
    spoof = apply_moire(crop)
    resized_s = cv2.resize(spoof, (fasi['shape'][2], fasi['shape'][1]))
    rgb_s = cv2.cvtColor(resized_s, cv2.COLOR_BGR2RGB).astype(np.float32)/255.0
    t_s_imagenet = np.expand_dims((rgb_s-mean)/std, axis=0)
    
    fas_interp.set_tensor(fasi['index'], t_s_imagenet)
    fas_interp.invoke()
    out_s_imagenet = fas_interp.get_tensor(faso['index'])[0]
    
    print(f"  Spoof Logits (ImageNet): {out_s_imagenet}")

print("\n--- MobileFaceNet Diagnostics ---")
fr_interp = tf.lite.Interpreter(model_path=MODEL_FR_PATH)
fr_interp.allocate_tensors()
fri = fr_interp.get_input_details()[0]
fro = fr_interp.get_output_details()[0]

img = test_imgs[0]
bbox = detect_face(img)
lm = estimate_landmarks(img, bbox)
print(f"Source Landmarks for image 1:\n{lm}")
print(f"Target ArcFace Anchors:\n{ARCFACE_ANCHORS}")

# Wait, let's get 2 identities to do genuine/impostor pairs
identities = {}
for d in os.listdir(LFW_DIR):
    dp = os.path.join(LFW_DIR, d)
    if os.path.isdir(dp):
        imgs = [os.path.join(dp, f) for f in os.listdir(dp) if f.endswith('.jpg')]
        if len(imgs) >= 5:
            identities[d] = imgs
            if len(identities) == 2:
                break

embs = {}
for ident, paths in identities.items():
    embs[ident] = []
    for p in paths[:5]:
        img = cv2.imread(p)
        bbox = detect_face(img)
        if bbox:
            lm = estimate_landmarks(img, bbox)
            alg = umeyama_align(img, lm)
            rgb = cv2.cvtColor(alg, cv2.COLOR_BGR2RGB)
            t = np.expand_dims((rgb.astype(np.float32) - 127.5) / 128.0, axis=0)
            fr_interp.set_tensor(fri['index'], t)
            fr_interp.invoke()
            e = fr_interp.get_tensor(fro['index'])[0].copy()
            e /= np.linalg.norm(e)
            embs[ident].append(e)

id1, id2 = list(identities.keys())
print("\nGenuine pairs:")
for i in range(1, len(embs[id1])):
    print(f"  Sim: {np.dot(embs[id1][0], embs[id1][i]):.4f}")

print("\nImpostor pairs:")
for i in range(len(embs[id2])):
    print(f"  Sim: {np.dot(embs[id1][0], embs[id2][i]):.4f}")

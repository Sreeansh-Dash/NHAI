import os
import cv2
import numpy as np
import tensorflow as tf
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from run_benchmark import apply_moire_spoof, preprocess_for_fr

DATASET_DIR = "dataset"
LFW_DIR = os.path.join(DATASET_DIR, "lfw_funneled")

def get_images(num_identities=2, images_per_identity=5):
    identities = {}
    for root, dirs, files in os.walk(LFW_DIR):
        imgs = [os.path.join(root, f) for f in files if f.endswith('.jpg')]
        if len(imgs) >= images_per_identity:
            name = os.path.basename(root)
            identities[name] = imgs[:images_per_identity]
            if len(identities) >= num_identities:
                break
    return identities

def main():
    MODEL_FR = "DatalakeBiometric/android/app/src/main/assets/models/mobilefacenet.tflite"
    MODEL_FAS = "DatalakeBiometric/android/app/src/main/assets/models/minifasnet_v2_se.tflite"

    fr_interp = tf.lite.Interpreter(model_path=MODEL_FR)
    fr_interp.allocate_tensors()
    fr_in = fr_interp.get_input_details()
    fr_out = fr_interp.get_output_details()

    fas_interp = tf.lite.Interpreter(model_path=MODEL_FAS)
    fas_interp.allocate_tensors()
    fas_in = fas_interp.get_input_details()
    fas_out = fas_interp.get_output_details()

    identities = get_images(num_identities=3, images_per_identity=5)
    
    # MiniFASNet debugging
    print("--- MiniFASNet Debug ---")
    w, h = fas_in[0]['shape'][1:3]
    print(f"Model expected shape: {w}x{h}")
    
    all_imgs = []
    for imgs in identities.values():
        all_imgs.extend(imgs)
    test_imgs = all_imgs[:5]

    for norm_name, use_imagenet in [("ImageNet", True), ("Div255", False)]:
        print(f"\nTesting normalization: {norm_name}")
        for i, img_path in enumerate(test_imgs):
            img = cv2.imread(img_path)
            
            # Genuine
            resized = cv2.resize(img, (w, h))
            rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            if use_imagenet:
                mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
                std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
                tensor = (rgb - mean) / std
            else:
                tensor = rgb
            
            fas_interp.set_tensor(fas_in[0]['index'], np.expand_dims(tensor, axis=0))
            fas_interp.invoke()
            out0 = fas_interp.get_tensor(fas_out[0]['index'])[0]
            out1 = fas_interp.get_tensor(fas_out[1]['index'])[0]
            
            # Spoof
            img_spf = apply_moire_spoof(img)
            resized_spf = cv2.resize(img_spf, (w, h))
            rgb_spf = cv2.cvtColor(resized_spf, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            if use_imagenet:
                tensor_spf = (rgb_spf - mean) / std
            else:
                tensor_spf = rgb_spf
            
            fas_interp.set_tensor(fas_in[0]['index'], np.expand_dims(tensor_spf, axis=0))
            fas_interp.invoke()
            out0_spf = fas_interp.get_tensor(fas_out[0]['index'])[0]
            out1_spf = fas_interp.get_tensor(fas_out[1]['index'])[0]
            
            def sf(x): return np.exp(x)/sum(np.exp(x))
            
            print(f" Image {i}:")
            print(f"  Gen out0: {out0}")
            print(f"  Gen out1: {out1}")
            print(f"  Gen out0_sf: {sf(out0)}")
            print(f"  Gen out1_sf: {sf(out1)}")
            print(f"  Spf out0: {out0_spf}")
            print(f"  Spf out1: {out1_spf}")
            print(f"  Spf out0_sf: {sf(out0_spf)}")
            print(f"  Spf out1_sf: {sf(out1_spf)}")

    # MobileFaceNet debugging
    print("\n--- MobileFaceNet Debug ---")
    def get_emb(img):
        tensor = preprocess_for_fr(img)
        if tensor is None: return None
        fr_interp.set_tensor(fr_in[0]['index'], tensor)
        fr_interp.invoke()
        e = fr_interp.get_tensor(fr_out[0]['index'])[0]
        n = np.linalg.norm(e)
        return e / n if n > 0 else e

    embs = {}
    for name, imgs in identities.items():
        embs[name] = []
        for p in imgs:
            e = get_emb(cv2.imread(p))
            if e is not None: embs[name].append(e)

    # Genuine scores
    gen_scores = []
    for name, e_list in embs.items():
        for i in range(len(e_list)):
            for j in range(i+1, len(e_list)):
                gen_scores.append(np.dot(e_list[i], e_list[j]))
    print("Genuine scores (first 10):", gen_scores[:10])

    # Impostor scores
    imp_scores = []
    names = list(embs.keys())
    if len(names) >= 2:
        for e1 in embs[names[0]]:
            for e2 in embs[names[1]]:
                imp_scores.append(np.dot(e1, e2))
    print("Impostor scores (first 10):", imp_scores[:10])

if __name__ == '__main__':
    main()

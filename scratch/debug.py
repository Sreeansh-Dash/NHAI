import os
import cv2
import numpy as np
import tensorflow as tf
import urllib.request
import tarfile

# Download some images to test
DATASET_DIR = "dataset"
LFW_DIR = os.path.join(DATASET_DIR, "lfw_funneled")

def get_a_few_images():
    if not os.path.exists(LFW_DIR):
        print("LFW not found, downloading a small part...")
        # Since downloading whole LFW is slow, let's just download a few images from wikimedia
        import requests
        WIKI_UA = 'NHAIHackathonBiometricBenchmark/1.0'
        search_url = "https://commons.wikimedia.org/w/api.php"
        params = {
            "action": "query", "generator": "search", "gsrsearch": "Indian portrait face photo",
            "gsrnamespace": "6", "gsrlimit": "10", "prop": "imageinfo", "iiprop": "url", "format": "json"
        }
        r = requests.get(search_url, params=params, headers={'User-Agent': WIKI_UA})
        data = r.json()
        pages = data.get("query", {}).get("pages", {})
        urls = []
        for pid, p in pages.items():
            img_info = p.get("imageinfo", [])
            if img_info:
                url = img_info[0].get("url", "")
                if url.endswith('.jpg'): urls.append(url)
        os.makedirs("scratch/images", exist_ok=True)
        img_paths = []
        for i, url in enumerate(urls[:5]):
            path = f"scratch/images/img_{i}.jpg"
            urllib.request.urlretrieve(url, path)
            img_paths.append(path)
        return img_paths
    else:
        # Get from LFW
        paths = []
        for root, dirs, files in os.walk(LFW_DIR):
            for f in files:
                if f.endswith('.jpg'):
                    paths.append(os.path.join(root, f))
                if len(paths) >= 5: break
            if len(paths) >= 5: break
        return paths

def main():
    MODEL_FR = "DatalakeBiometric/android/app/src/main/assets/models/mobilefacenet.tflite"
    MODEL_FAS = "DatalakeBiometric/android/app/src/main/assets/models/minifasnet_v2_se.tflite"

    print(f"Loading FR model: {MODEL_FR}")
    fr_interp = tf.lite.Interpreter(model_path=MODEL_FR)
    fr_interp.allocate_tensors()
    print("FR Input details:", fr_interp.get_input_details())
    print("FR Output details:", fr_interp.get_output_details())

    print(f"\nLoading FAS model: {MODEL_FAS}")
    fas_interp = tf.lite.Interpreter(model_path=MODEL_FAS)
    fas_interp.allocate_tensors()
    fas_in = fas_interp.get_input_details()
    print("FAS Input details:", fas_in)
    print("FAS Output details:", fas_interp.get_output_details())

    imgs = get_a_few_images()
    print(f"Got {len(imgs)} images to test.")

    # MiniFASNet Debug
    print("\n--- MiniFASNet Debug ---")
    for img_path in imgs:
        img = cv2.imread(img_path)
        if img is None: continue
        
        # Resize to model input size (which seems to be what we need to find out)
        input_shape = fas_in[0]['shape']
        h, w = input_shape[1:3]
        print(f"\nTesting image {img_path}, resizing to {w}x{h}")
        resized = cv2.resize(img, (w, h))
        
        # Test 1: ImageNet Normalization
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        norm_imagenet = (rgb - mean) / std
        norm_imagenet = np.expand_dims(norm_imagenet, axis=0)
        
        fas_interp.set_tensor(fas_in[0]['index'], norm_imagenet)
        fas_interp.invoke()
        logits = fas_interp.get_tensor(fas_interp.get_output_details()[0]['index'])[0]
        print(f"ImageNet Norm Logits: {logits}")
        print(f"  1.0 - logits[7] = {1.0 - logits[7]:.4f}")
        print(f"  logits[1] = {logits[1]:.4f}")
        
        # Test 2: Div 255 Normalization (no mean/std)
        # Actually some MiniFASNet versions don't even convert to RGB, but let's test RGB/255
        norm_div255 = np.expand_dims(rgb, axis=0)
        fas_interp.set_tensor(fas_in[0]['index'], norm_div255)
        fas_interp.invoke()
        logits2 = fas_interp.get_tensor(fas_interp.get_output_details()[0]['index'])[0]
        print(f"Div255 Norm Logits: {logits2}")
        print(f"  1.0 - logits[7] = {1.0 - logits2[7]:.4f}")
        print(f"  logits[1] = {logits2[1]:.4f}")
        
        # Try BGR / 255
        bgr_norm = np.expand_dims(resized.astype(np.float32) / 255.0, axis=0)
        fas_interp.set_tensor(fas_in[0]['index'], bgr_norm)
        fas_interp.invoke()
        logits3 = fas_interp.get_tensor(fas_interp.get_output_details()[0]['index'])[0]
        print(f"BGR Div255 Logits: {logits3}")
        
        break # just one image is enough for now

if __name__ == '__main__':
    main()

import cv2
import requests
import numpy as np
import os

url = "https://commons.wikimedia.org/w/api.php"
params_search = {
    "action": "query",
    "generator": "search",
    "gsrsearch": "Indian portrait face -american -stamp -coin -banknote -rupee -flower -group -map -text -painting",
    "gsrnamespace": "6",
    "gsrlimit": "20",
    "prop": "imageinfo",
    "iiprop": "url",
    "format": "json"
}

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

r = requests.get(url, params=params_search, headers=headers, timeout=10)
data = r.json()
pages = data.get("query", {}).get("pages", {})
print(f"Found {len(pages)} pages.")

face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

for pid, p in pages.items():
    title = p.get("title", "")
    img_info = p.get("imageinfo", [])
    if not img_info:
        continue
    img_url = img_info[0].get("url", "")
    if not img_url.lower().endswith(('.jpg', '.jpeg', '.png')):
        continue
    
    print(f"\nEvaluating: {title} | URL: {img_url}")
    try:
        resp = requests.get(img_url, headers=headers, timeout=10)
        nparr = np.frombuffer(resp.content, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            print("Failed to decode image.")
            continue
        print(f"Image shape: {img.shape}")
        
        # Try face detection
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.1, 4)
        print(f"Detected {len(faces)} faces with default params.")
        
        # Try with slightly more relaxed params
        faces_relaxed = face_cascade.detectMultiScale(gray, 1.05, 3)
        print(f"Detected {len(faces_relaxed)} faces with relaxed params.")
    except Exception as e:
        print(f"Error: {e}")

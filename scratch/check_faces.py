import os, cv2
bd = r'c:\Users\Sreeansh Dash\OneDrive\Desktop\Projects\NHAI\DatalakeBiometric\benchmark_data\indian_faces'
items = [f for f in sorted(os.listdir(bd)) if f.endswith(('.jpg','.png'))]
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
detected = 0
total = 0
for f in items:
    img = cv2.imread(os.path.join(bd,f))
    if img is None:
        print(f'{f}: FAILED TO READ')
        continue
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.1, 4)
    total += 1
    has_face = len(faces) > 0
    detected += int(has_face)
    print(f'{f}: {img.shape} faces={len(faces)}')
print(f'\nDetection rate: {detected}/{total}')

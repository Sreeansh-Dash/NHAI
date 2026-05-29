import os
import cv2
import numpy as np

# ArcFace standard anchors for 112×112 alignment
ARCFACE_ANCHORS = np.array([
    [38.2946, 51.6963],   # left eye
    [73.5318, 51.6963],   # right eye
    [56.0252, 71.7366],   # nose
    [41.5493, 92.3655],   # mouth left
    [70.7299, 92.3655]    # mouth right
], dtype=np.float32)

def main():
    print("ArcFace Anchors expected by hackathon prompt:")
    print("left eye [38.29, 51.70]")
    print("right eye [73.53, 51.70]")
    print("nose [56.03, 71.74]")
    print("left mouth [41.55, 92.37]")
    print("right mouth [70.73, 92.37]")
    print("\nActual anchors in script:")
    for i, name in enumerate(["left eye", "right eye", "nose", "left mouth", "right mouth"]):
        print(f"{name}: {ARCFACE_ANCHORS[i]}")

if __name__ == '__main__':
    main()

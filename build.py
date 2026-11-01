#!/usr/bin/env python3
"""Build script: packages SFL Digging Assistant for Chrome Web Store."""
import zipfile, os, sys

VERSION = "1.0.0"
DIST_DIR = "dist"
ZIP_NAME = f"sfl-digging-assistant-{VERSION}.zip"

# Runtime files only — no dev docs, scratch files, .git, etc.
INCLUDE = [
    "manifest.json",
    "background.js",
    "bridge.js",
    "content.js",
    "sidepanel.html",
    "sidepanel.js",
    "overlay.css",
    "grid-themes.css",
    "custom-engine.css",
    "panels.css",
    "sand_shovel.png",
    "sand_drill.png",
    "PRIVACY.md",
]

# ITEMS/ files that are actually referenced
ITEMS_INCLUDE = [
    "camel_bone.webp", "Cheer.webp", "clam_shell.webp", "cockle_shell.webp",
    "coins.webp", "coral.png", "crab.png", "flower.webp", "happy.png",
    "hieroglyph.webp", "old_bottle.png", "otter_pebble.webp", "pearl.webp",
    "pipi.webp", "pirate_bounty.webp", "salt_dino_egg.webp", "sand.webp",
    "seaweed.webp", "sea_cucumber.png", "starfish.png", "stone.png",
    "stopwatch.png", "vase.webp", "wood.png", "wooden_compass.webp",
    "README.txt",
]

def build():
    os.makedirs(DIST_DIR, exist_ok=True)
    zip_path = os.path.join(DIST_DIR, ZIP_NAME)

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in INCLUDE:
            if os.path.exists(f):
                zf.write(f)
                print(f"  + {f}")
            else:
                print(f"  ! MISSING: {f}")

        for f in ITEMS_INCLUDE:
            path = os.path.join("ITEMS", f)
            if os.path.exists(path):
                zf.write(path)
                print(f"  + {path}")
            else:
                print(f"  ! MISSING: {path}")

    size_kb = os.path.getsize(zip_path) / 1024
    print(f"\nBuilt: {zip_path} ({size_kb:.1f} KB)")

if __name__ == "__main__":
    build()

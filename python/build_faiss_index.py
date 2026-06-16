"""Build FAISS index from data/faiss/vectors.json (written by Node build script)."""
import json
import sys
from pathlib import Path

import faiss
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FAISS_DIR = ROOT / "data" / "faiss"
VECTORS_FILE = FAISS_DIR / "vectors.json"
INDEX_FILE = FAISS_DIR / "index.faiss"
IDS_FILE = FAISS_DIR / "chunk_ids.json"


def main():
    if not VECTORS_FILE.exists():
        print("Missing", VECTORS_FILE, file=sys.stderr)
        sys.exit(1)

    with open(VECTORS_FILE, "r", encoding="utf-8") as f:
        payload = json.load(f)

    ids = payload["chunkIds"]
    vectors = np.array(payload["vectors"], dtype=np.float32)

    if len(vectors) == 0:
        print("No vectors to index", file=sys.stderr)
        sys.exit(1)

    dim = vectors.shape[1]
    faiss.normalize_L2(vectors)

    index = faiss.IndexFlatIP(dim)
    index.add(vectors)

    FAISS_DIR.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(INDEX_FILE))

    with open(IDS_FILE, "w", encoding="utf-8") as f:
        json.dump(ids, f)

    print(json.dumps({"ok": True, "count": len(ids), "dim": dim, "index": str(INDEX_FILE)}))


if __name__ == "__main__":
    main()

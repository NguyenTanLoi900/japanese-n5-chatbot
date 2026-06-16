"""Read query vector from stdin JSON, return top-k chunk ids via FAISS."""
import json
import sys
from pathlib import Path

import faiss
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
INDEX_FILE = ROOT / "data" / "faiss" / "index.faiss"
IDS_FILE = ROOT / "data" / "faiss" / "chunk_ids.json"

_index = None
_ids = None


def load():
    global _index, _ids
    if _index is None:
        _index = faiss.read_index(str(INDEX_FILE))
        with open(IDS_FILE, "r", encoding="utf-8") as f:
            _ids = json.load(f)


def main():
    load()
    req = json.load(sys.stdin)
    vector = np.array([req["vector"]], dtype=np.float32)
    top_k = int(req.get("topK", 6))
    faiss.normalize_L2(vector)
    scores, indices = _index.search(vector, top_k)
    ids = [_ids[i] for i in indices[0] if i >= 0]
    out = {
        "ids": ids,
        "scores": [float(s) for s in scores[0][: len(ids)]],
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()

"""
rag_client.py
ChromaDB PersistentClient 기반 벡터 검색 (별도 chroma 서버 불필요)

DB: ../assistant/vectordb_v2 (청크 7,935개, 384차원)

검색 전략:
1. 약어(대문자 토큰) → glossary 딕셔너리 직접 매칭 (정확도 보장)
2. query_texts로 ChromaDB에 위임 → 임베딩 모델 일치 보장

무거운 의존(chromadb, sentence-transformers)은 첫 검색 시에만 로드된다.
서버 기동 시 로드하면 시작이 수 초 느려지므로 lazy-load를 유지할 것.
"""
import os
import re

COLLECTION_NAME = "hynix_rag"
EMBED_MODEL     = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

# 벡터 DB는 assistant 폴더에 그대로 둔다 (독립 실행 페이지와 공용)
VECTORDB_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "assistant", "vectordb_v2")
)

_client     = None
_collection = None
_ef         = None
_glossary   = {}


def _get_ef():
    global _ef
    if _ef is None:
        from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
        _ef = SentenceTransformerEmbeddingFunction(model_name=EMBED_MODEL)
    return _ef


def _get_collection():
    global _client, _collection
    if _collection is None:
        import chromadb
        if not os.path.exists(VECTORDB_PATH):
            raise FileNotFoundError(f"벡터 DB를 찾을 수 없습니다: {VECTORDB_PATH}")
        _client = chromadb.PersistentClient(path=VECTORDB_PATH)
        _collection = _client.get_collection(COLLECTION_NAME, embedding_function=_get_ef())
    return _collection


def _load_glossary():
    """glossary 청크를 '괄호 앞 전체 약어(소문자)' → 텍스트 딕셔너리로 로드"""
    global _glossary
    if _glossary:
        return
    try:
        col = _get_collection()
        results = col.get(where={"category": "glossary"}, include=["documents"], limit=10000)
        for doc in results["documents"]:
            m = re.match(r'^([^(]+)\s*\(', doc)
            if m:
                _glossary[m.group(1).strip().lower()] = doc
    except Exception:
        pass


def _glossary_lookup(query: str) -> list[dict]:
    """쿼리에서 영문 토큰을 추출해 glossary 정확 매칭 (긴 N-gram 우선)"""
    _load_glossary()
    hits, seen = [], set()
    tokens = re.findall(r'[A-Za-z][A-Za-z0-9/_\-]*', query)

    candidates = []
    for length in range(min(4, len(tokens)), 0, -1):
        for start in range(len(tokens) - length + 1):
            phrase = " ".join(tokens[start:start + length]).lower()
            candidates.append(phrase)

    for key in candidates:
        if key in _glossary and key not in seen:
            seen.add(key)
            hits.append({
                "text": _glossary[key], "source": "glossary",
                "category": "glossary", "topic": "glossary", "distance": 0.0,
            })
    return hits


def search(query: str, n_results: int = 5, category_filter: str | None = None) -> list[dict]:
    try:
        col = _get_collection()

        # 1. glossary 약어 직접 매칭
        glossary_hits = _glossary_lookup(query) if not category_filter else []

        # 2. ChromaDB 의미 검색 (embedding_function이 자동 임베딩)
        where = {"category": category_filter} if category_filter else None
        fetch = n_results + len(glossary_hits)
        results = col.query(
            query_texts=[query],
            n_results=fetch,
            where=where,
            include=["documents", "metadatas", "distances"],
        )
        docs  = results["documents"][0]
        metas = results["metadatas"][0]
        dists = results["distances"][0]

        semantic = [
            {
                "text":     doc,
                "source":   meta.get("title", ""),
                "category": meta.get("category", ""),
                "topic":    meta.get("topic", ""),
                "distance": round(dist, 4),
            }
            for doc, meta, dist in zip(docs, metas, dists)
        ]

        # 3. glossary 우선, 의미 검색으로 채움
        glossary_texts = {h["text"] for h in glossary_hits}
        merged = glossary_hits + [s for s in semantic if s["text"] not in glossary_texts]
        return merged[:n_results]

    except Exception:
        return []


def get_collection_stats() -> dict:
    try:
        col = _get_collection()
        try:
            total = col.count()
        except Exception:
            total = -1
        return {"total_chunks": total, "available": True}
    except Exception:
        return {"total_chunks": 0, "available": False}

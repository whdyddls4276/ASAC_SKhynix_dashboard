"""
rag_client.py
ChromaDB 벡터 DB 쿼리 클라이언트
"""
import os
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer

# 기업/rag_db (Desktop 수준에서 공유되는 DB)
RAG_DB_DIR = Path(__file__).parent.parent.parent.parent.parent.parent / "기업" / "rag_db"
VECTORDB_DIR = RAG_DB_DIR / "vectordb"
COLLECTION_NAME = "hynix_rag"
EMBED_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

_client = None
_collection = None
_embedder = None


def _get_collection():
    global _client, _collection
    if _collection is None:
        try:
            _client = chromadb.PersistentClient(path=str(VECTORDB_DIR))
            _collection = _client.get_collection(COLLECTION_NAME)
        except Exception as e:
            raise RuntimeError(f"RAG DB 로드 실패 (02_build_db.py 실행 필요): {e}")
    return _collection


def _get_embedder():
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer(EMBED_MODEL)
    return _embedder


def search(query: str, n_results: int = 5, category_filter: str | None = None) -> list[dict]:
    """쿼리와 관련된 문서 청크 검색. RAG DB 없으면 빈 리스트 반환."""
    try:
        col = _get_collection()
        emb = _get_embedder()
        q_vec = emb.encode(query).tolist()

        where = {"category": category_filter} if category_filter else None
        results = col.query(
            query_embeddings=[q_vec],
            n_results=n_results,
            where=where,
            include=["documents", "metadatas", "distances"],
        )

        chunks = []
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
        ):
            chunks.append({
                "text": doc,
                "source": meta.get("title", ""),
                "category": meta.get("category", ""),
                "distance": round(float(dist), 4),
            })
        return chunks
    except Exception:
        return []


def get_collection_stats() -> dict:
    try:
        col = _get_collection()
        return {"total_chunks": col.count(), "available": True}
    except Exception:
        return {"total_chunks": 0, "available": False}

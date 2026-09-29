"""RAG 엔진 (문서 로드 + 벡터스토어 + LLM 체인).

my_project.py(Gradio)에 섞여 있던 RAG 로직을 추출해 재사용 가능하게 만들었다.
FastAPI 백엔드와 Gradio가 공유할 수 있다.

핵심 차이:
- import 시점에 즉시 실행하지 않고, RagEngine 인스턴스 생성 시 1회 초기화한다.
- get_engine() lazy singleton으로 FastAPI startup에서 한 번만 임베딩한다.
- get_chain(history_text)은 history를 인자로 받아 전역 의존을 제거했다.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil

import pandas as pd
from langchain.prompts import ChatPromptTemplate
from langchain.schema.runnable import RunnablePassthrough
from langchain_chroma import Chroma
from langchain_community.document_loaders import (
    DataFrameLoader,
    PyPDFLoader,
    TextLoader,
)
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_huggingface.embeddings import HuggingFaceEmbeddings
from langchain_openai import ChatOpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import settings
from prompts import load_prompt

logger = logging.getLogger("regulations_chatbot")


def _load_documents_from_directory(directory: str) -> list:
    """data/ 하위 모든 서브디렉토리를 재귀 탐색해 PDF/TXT/XLSX 파일을 로드."""
    docs = []
    for dirpath, _dirnames, filenames in os.walk(directory):
        for filename in filenames:
            filepath = os.path.join(dirpath, filename)
            if filename.endswith('.pdf'):
                loader = PyPDFLoader(filepath)
                docs.extend(loader.load())
            elif filename.endswith('.txt'):
                loader = TextLoader(filepath, encoding='utf-8')
                docs.extend(loader.load())
            elif filename.endswith('.xlsx'):
                df = pd.read_excel(filepath)
                if df.empty:
                    continue
                df = df.fillna('')
                df['content'] = df.apply(lambda row: ' '.join(row.astype(str)), axis=1)
                df = df[['content']]
                loader = DataFrameLoader(df, page_content_column="content")
                docs.extend(loader.load())
    return docs


_DOC_EXTENSIONS = ('.pdf', '.txt', '.xlsx')  # _load_documents_from_directory 가 읽는 형식


def _compute_docs_hash(directory: str) -> str:
    """문서 디렉토리의 시그니처(상대경로+크기+수정시각) 해시. 변경 시 재임베딩 트리거.

    로더가 읽는 문서 형식만 포함한다. 같은 data/ 에 있는 sessions.db 등이
    섞이면 채팅할 때마다 해시가 바뀌어 재시작마다 전체 재임베딩이 일어난다.
    """
    signature = []
    for dirpath, _dirnames, filenames in os.walk(directory):
        for filename in sorted(filenames):
            if not filename.endswith(_DOC_EXTENSIONS):
                continue
            path = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(path, directory)
            stat = os.stat(path)
            signature.append((rel_path, stat.st_size, int(stat.st_mtime)))
    signature.sort(key=lambda x: x[0])
    raw = json.dumps(signature, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def _format_docs(docs) -> str:
    return "\n\n".join(doc.page_content for doc in docs)


def _extract_sources(docs) -> list[dict]:
    """Document 목록에서 중복 제거된 출처 정보 추출."""
    seen, sources = set(), []
    for doc in docs:
        name = os.path.basename(doc.metadata.get("source", ""))
        page = doc.metadata.get("page")  # PDF만 존재, TXT는 None
        key = (name, page)
        if name and key not in seen:
            seen.add(key)
            sources.append({"file": name, "page": page})
    return sources


class RagEngine:
    """문서 로드 → 임베딩 → Chroma → retriever → LLM 체인을 구성하는 엔진.

    생성 시 무거운 초기화(임베딩)가 1회 일어난다. Chroma 캐시가 있으면 빠르다.
    """

    def __init__(self):
        self.active_model_name = (
            settings.openai_model if settings.llm_provider == "openai"
            else settings.gemini_model
        )
        self._load_documents()
        self._build_vectorstore()
        self._build_model()
        system_template = (
            load_prompt("system")
            .replace("__COMPANY_NAME__", settings.company_name or "the company")
            .replace("__REGULATION_SCOPE__", settings.regulation_scope)
            .replace("__URL_TABLE__", load_prompt("urls"))
        )
        self.prompt_template = ChatPromptTemplate.from_template(system_template)

    # ----- 초기화 단계 -----
    def _load_documents(self):
        docs = _load_documents_from_directory(settings.data_dir)
        if not docs:
            raise ValueError("No documents found in the specified directory.")
        if len(docs) > 1000:
            raise ValueError("Too many documents loaded. Please limit to 1000 documents or less.")
        if len(docs) < 5:
            raise ValueError("Not enough documents loaded. Please ensure at least 5 documents are present.")
        logger.info("문서 로드 완료: %d개 조각 (%s)", len(docs), settings.data_dir)

        self.embeddings = HuggingFaceEmbeddings(model_name=settings.embedding_model)
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.chunk_size, chunk_overlap=settings.chunk_overlap
        )
        self.chunks = splitter.split_documents(docs)

    def _build_vectorstore(self):
        """Chroma 영구 캐싱 + 문서 변경 자동 감지 (my_project.py 로직 그대로)."""
        chroma_dir = settings.chroma_dir
        hash_path = os.path.join(chroma_dir, "docs.hash")
        current_hash = _compute_docs_hash(settings.data_dir)

        saved_hash = None
        if os.path.exists(hash_path):
            with open(hash_path, "r", encoding="utf-8") as f:
                saved_hash = f.read().strip()

        chroma_db_exists = os.path.exists(os.path.join(chroma_dir, "chroma.sqlite3"))

        if chroma_db_exists and saved_hash == current_hash:
            logger.info("Chroma 캐시된 컬렉션 로드 (해시 일치: %s)", current_hash[:8])
            self.vector_store = Chroma(
                collection_name=settings.chroma_collection,
                embedding_function=self.embeddings,
                persist_directory=chroma_dir,
            )
        else:
            reason = "저장된 컬렉션 없음" if saved_hash is None else "문서 변경 감지"
            logger.info("Chroma 컬렉션 신규 생성 (%s) — 임베딩 진행 중...", reason)
            if os.path.exists(chroma_dir):
                shutil.rmtree(chroma_dir)
            self.vector_store = Chroma.from_documents(
                documents=self.chunks,
                embedding=self.embeddings,
                collection_name=settings.chroma_collection,
                persist_directory=chroma_dir,
            )
            with open(hash_path, "w", encoding="utf-8") as f:
                f.write(current_hash)
            logger.info("Chroma 컬렉션 저장 완료 (해시: %s)", current_hash[:8])

        self.retriever = self.vector_store.as_retriever(
            search_kwargs={"k": settings.retriever_k}
        )

    def _build_model(self):
        """provider 스위치에 따라 OpenAI / Gemini 모델 초기화."""
        if settings.llm_provider == "openai":
            self.model = ChatOpenAI(
                model=settings.openai_model,
                api_key=settings.openai_api_key or None,
                temperature=settings.llm_temperature,
                timeout=settings.llm_timeout,
                max_retries=settings.llm_max_retries,
                stream_usage=settings.openai_stream_usage,
            )
        else:  # gemini (기본)
            self.model = ChatGoogleGenerativeAI(
                model=settings.gemini_model,
                google_api_key=settings.google_api_key or None,
                temperature=settings.llm_temperature,
                timeout=settings.llm_timeout,
                max_retries=settings.llm_max_retries,
            )

    # ----- 체인 / 토큰 -----
    def get_chain(self, history_text: str = ""):
        """RAG 체인 구성. history_text를 인자로 받아 프롬프트에 주입.

        끝에 StrOutputParser를 붙이지 않는다 → AIMessage(Chunk)를 그대로 흘려
        응답 텍스트와 함께 usage_metadata(토큰)를 추출할 수 있다.
        """
        return (
            {
                "context": self.retriever | _format_docs,
                "question": RunnablePassthrough(),
                "chat_history": lambda _: history_text,
            }
            | self.prompt_template
            | self.model
        )

    def get_chain_with_context(self, history_text: str, context_str: str):
        """미리 검색된 context 문자열을 직접 주입하는 체인 (출처 표시용).

        routes.py에서 retriever를 먼저 호출해 source_docs를 얻은 뒤,
        같은 context로 LLM 체인을 돌릴 때 사용한다.
        """
        return (
            {
                "context": lambda _: context_str,
                "question": RunnablePassthrough(),
                "chat_history": lambda _: history_text,
            }
            | self.prompt_template
            | self.model
        )

    def retrieve_with_sources(self, question: str) -> tuple[str, list[dict]]:
        """질문으로 문서 검색 후 (context_str, sources) 반환.

        routes.py에서 한 번 호출하면 체인과 출처 표시에 모두 재사용할 수 있다.
        """
        docs = self.retriever.invoke(question)
        context_str = _format_docs(docs)
        sources = _extract_sources(docs)
        return context_str, sources

    @staticmethod
    def extract_usage(usage_metadata: dict | None) -> dict:
        """LangChain usage_metadata(dict)에서 토큰 사용량을 추출.

        OpenAI/Gemini 모두 동일한 표준 스키마를 사용한다.
        """
        usage_metadata = usage_metadata or {}
        return {
            "tokens_input": usage_metadata.get("input_tokens", 0) or 0,
            "tokens_output": usage_metadata.get("output_tokens", 0) or 0,
            "tokens_cached": (usage_metadata.get("input_token_details") or {}).get("cache_read", 0) or 0,
        }


# ===== lazy singleton =====
_engine: RagEngine | None = None


def get_engine() -> RagEngine:
    """RagEngine 싱글톤 반환. 최초 호출 시 1회 초기화(임베딩)."""
    global _engine
    if _engine is None:
        _engine = RagEngine()
    return _engine

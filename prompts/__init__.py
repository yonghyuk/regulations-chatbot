"""프롬프트 템플릿 로더.

프롬프트를 코드에서 분리해 ./prompts/*.md 파일로 관리한다.
프롬프트 수정 시 코드를 건드릴 필요가 없고, git으로 버전 추적이 쉽다.
"""

from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent


def load_prompt(name: str) -> str:
    """prompts/<name>.md 파일을 읽어 문자열로 반환.

    Args:
        name: 확장자(.md)를 제외한 프롬프트 파일 이름. 예) "system"

    Returns:
        프롬프트 템플릿 문자열.
    """
    path = _PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"프롬프트 파일을 찾을 수 없습니다: {path}")
    return path.read_text(encoding="utf-8")

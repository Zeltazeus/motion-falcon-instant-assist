"""Load the approved Motion Falcon assistant content from Vercel."""

import json
from dataclasses import dataclass

import aiohttp

MAX_KNOWLEDGE_BYTES = 50_000
ALLOWED_CONTENT_TYPES = ("application/json",)


@dataclass(frozen=True)
class MotionFalconKnowledge:
    """The policy and public knowledge used by the Motion Falcon assistant."""

    policy: str
    public_knowledge: str

    def system_instruction(self) -> str:
        """Return the instruction supplied to the conversation model."""
        return (
            f"{self.policy}\n\n# Approved Motion Falcon Public Knowledge\n\n{self.public_knowledge}"
        )


async def _fetch_knowledge(
    session: aiohttp.ClientSession, url: str, token: str
) -> MotionFalconKnowledge:
    """Fetch approved Motion Falcon content from the authenticated Vercel endpoint."""
    async with session.get(url, headers={"Authorization": f"Bearer {token}"}) as response:
        if response.status != 200:
            raise RuntimeError(f"Knowledge request failed with HTTP {response.status}: {url}")

        content_type = response.headers.get("Content-Type", "").lower()
        if not any(content_type.startswith(allowed) for allowed in ALLOWED_CONTENT_TYPES):
            raise RuntimeError(f"Knowledge response is not JSON: {url}")

        content_length = response.content_length
        if content_length is not None and content_length > MAX_KNOWLEDGE_BYTES:
            raise RuntimeError(f"Knowledge response exceeds {MAX_KNOWLEDGE_BYTES} bytes: {url}")

        body = await response.content.read(MAX_KNOWLEDGE_BYTES + 1)
        if len(body) > MAX_KNOWLEDGE_BYTES:
            raise RuntimeError(f"Knowledge response exceeds {MAX_KNOWLEDGE_BYTES} bytes: {url}")

    try:
        payload = json.loads(body.decode("utf-8"))
    except UnicodeDecodeError as error:
        raise RuntimeError(f"Knowledge response is not UTF-8: {url}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Knowledge response is not valid JSON: {url}") from error

    policy = payload.get("policy")
    public_knowledge = payload.get("publicKnowledge")
    if not isinstance(policy, str) or not isinstance(public_knowledge, str):
        raise RuntimeError(f"Knowledge response has an invalid schema: {url}")
    if not policy.strip() or not public_knowledge.strip():
        raise RuntimeError(f"Knowledge response is empty: {url}")
    return MotionFalconKnowledge(policy=policy.strip(), public_knowledge=public_knowledge.strip())


async def load_motion_falcon_knowledge(knowledge_url: str, token: str) -> MotionFalconKnowledge:
    """Load Motion Falcon content from the protected Vercel endpoint.

    Args:
        knowledge_url: Protected URL for the approved Motion Falcon content.
        token: Bearer token shared with the Vercel endpoint.

    Returns:
        The validated policy and public knowledge for one bot process.
    """
    if not knowledge_url or not token:
        raise RuntimeError(
            "MOTION_FALCON_KNOWLEDGE_URL and MOTION_FALCON_KNOWLEDGE_TOKEN are required."
        )

    timeout = aiohttp.ClientTimeout(total=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        return await _fetch_knowledge(session, knowledge_url, token)

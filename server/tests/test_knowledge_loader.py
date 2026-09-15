"""Tests for Motion Falcon's Vercel knowledge loader."""

import unittest
from pathlib import Path

from aiohttp import web

from knowledge_loader import MAX_KNOWLEDGE_BYTES, load_motion_falcon_knowledge


class KnowledgeLoaderTest(unittest.IsolatedAsyncioTestCase):
    """Validate remote knowledge documents before they reach the conversation model."""

    async def asyncSetUp(self) -> None:
        self._app = web.Application()
        self._app.router.add_get("/knowledge", self._knowledge)
        self._app.router.add_get("/html", self._html)
        self._app.router.add_get("/large", self._large)
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        self._site = web.TCPSite(self._runner, "127.0.0.1", 0)
        await self._site.start()
        sockets = self._site._server.sockets
        self._base_url = f"http://127.0.0.1:{sockets[0].getsockname()[1]}"

    async def asyncTearDown(self) -> None:
        await self._runner.cleanup()

    async def _knowledge(self, request: web.Request) -> web.Response:
        if request.headers.get("Authorization") != "Bearer test-token":
            return web.Response(status=401)
        return web.json_response(
            {"policy": "You are Falcon.", "publicKnowledge": "# Motion Falcon\nApproved facts."}
        )

    async def _html(self, request: web.Request) -> web.Response:
        return web.Response(text="<html>error</html>", content_type="text/html")

    async def _large(self, request: web.Request) -> web.Response:
        return web.Response(text="x" * (MAX_KNOWLEDGE_BYTES + 1), content_type="application/json")

    async def test_loads_documents_and_builds_instruction(self) -> None:
        knowledge = await load_motion_falcon_knowledge(f"{self._base_url}/knowledge", "test-token")

        self.assertEqual(knowledge.policy, "You are Falcon.")
        self.assertIn("Approved Motion Falcon Public Knowledge", knowledge.system_instruction())
        self.assertIn("Approved facts.", knowledge.system_instruction())

    async def test_rejects_non_text_response(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "not JSON"):
            await load_motion_falcon_knowledge(f"{self._base_url}/html", "test-token")

    async def test_rejects_oversized_response(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "exceeds"):
            await load_motion_falcon_knowledge(f"{self._base_url}/large", "test-token")

    async def test_rejects_an_invalid_bearer_token(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
            await load_motion_falcon_knowledge(f"{self._base_url}/knowledge", "wrong-token")


class MotionFalconPolicyTest(unittest.TestCase):
    """Validate important behavioral constraints in the approved policy."""

    def test_policy_does_not_refer_visitors_to_alternative_providers(self) -> None:
        policy_path = Path(__file__).parents[2] / "api" / "knowledge" / "motion-falcon-policy.md"
        policy = policy_path.read_text(encoding="utf-8")

        self.assertIn("Do not recommend, compare, refer to, or suggest freelancers", policy)
        self.assertIn("A visitor's budget is useful discovery information", policy)

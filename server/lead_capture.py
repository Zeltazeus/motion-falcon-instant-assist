"""Consented Motion Falcon lead delivery integrations."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass

import aiohttp

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_TRANSCRIPT_CHARS = 15_000


@dataclass(frozen=True)
class LeadCapture:
    """Validated visitor details and delivery consents."""

    name: str
    email: str
    recap_consent: bool
    transcript_consent: bool

    @classmethod
    def from_payload(cls, payload: object) -> LeadCapture:
        """Build a consented lead from an RTVI event payload."""
        if not isinstance(payload, dict):
            raise ValueError("Lead details must be an object.")

        name = str(payload.get("name", "")).strip()
        email = str(payload.get("email", "")).strip().lower()
        recap_consent = payload.get("recapConsent") is True
        transcript_consent = payload.get("transcriptConsent") is True
        if not name or len(name) > 120:
            raise ValueError("Enter a name of up to 120 characters.")
        if not EMAIL_PATTERN.fullmatch(email) or len(email) > 254:
            raise ValueError("Enter a valid email address.")
        if not recap_consent and not transcript_consent:
            raise ValueError("Choose at least one sharing option.")
        return cls(name, email, recap_consent, transcript_consent)


class LeadDelivery:
    """Sends opted-in lead data to HubSpot and Resend."""

    def __init__(
        self, *, hubspot_token: str, resend_api_key: str, email_from: str, calendly_url: str
    ):
        self._hubspot_token = hubspot_token
        self._resend_api_key = resend_api_key
        self._email_from = email_from
        self._calendly_url = calendly_url

    async def deliver(self, lead: LeadCapture, transcript: str = "") -> None:
        """Upsert an opted-in contact, store its consent note, and send its requested recap."""
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            contact_id = await self._upsert_contact(session, lead)
            await self._create_note(session, contact_id, lead, transcript)
            if lead.recap_consent:
                await self._send_recap(session, lead)

    async def _upsert_contact(self, session: aiohttp.ClientSession, lead: LeadCapture) -> str:
        payload = {
            "inputs": [
                {
                    "id": lead.email,
                    "idProperty": "email",
                    "properties": {
                        "email": lead.email,
                        "firstname": lead.name,
                        "lifecyclestage": "lead",
                    },
                }
            ]
        }
        headers = {"Authorization": f"Bearer {self._hubspot_token}"}
        async with session.post(
            "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert",
            json=payload,
            headers=headers,
        ) as response:
            body = await response.json(content_type=None)
            if response.status >= 300 or not body.get("results"):
                raise RuntimeError("HubSpot contact delivery failed.")
            return str(body["results"][0]["id"])

    async def _create_note(
        self, session: aiohttp.ClientSession, contact_id: str, lead: LeadCapture, transcript: str
    ) -> None:
        details = [
            "Motion Falcon instant-assist enquiry",
            f"Recap email consent: {'yes' if lead.recap_consent else 'no'}",
            f"Transcript retention consent: {'yes' if lead.transcript_consent else 'no'}",
        ]
        if lead.transcript_consent and transcript:
            details.extend(["Transcript:", transcript[:MAX_TRANSCRIPT_CHARS]])
        payload = {
            "properties": {"hs_note_body": "<br>".join(html.escape(item) for item in details)},
            "associations": [
                {
                    "to": {"id": contact_id},
                    "types": [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 202}],
                }
            ],
        }
        headers = {"Authorization": f"Bearer {self._hubspot_token}"}
        async with session.post(
            "https://api.hubapi.com/crm/v3/objects/notes", json=payload, headers=headers
        ) as response:
            if response.status >= 300:
                raise RuntimeError("HubSpot note delivery failed.")

    async def _send_recap(self, session: aiohttp.ClientSession, lead: LeadCapture) -> None:
        payload = {
            "from": self._email_from,
            "to": [lead.email],
            "subject": "Your Motion Falcon project conversation",
            "html": f'<p>Thanks for speaking with Motion Falcon, {html.escape(lead.name)}.</p><p>Choose a time for a project conversation: <a href="{html.escape(self._calendly_url, quote=True)}">Book with Motion Falcon</a>.</p>',
        }
        headers = {"Authorization": f"Bearer {self._resend_api_key}"}
        async with session.post(
            "https://api.resend.com/emails", json=payload, headers=headers
        ) as response:
            if response.status >= 300:
                raise RuntimeError("Recap email delivery failed.")

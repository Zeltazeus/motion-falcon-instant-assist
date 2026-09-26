"""Consented Motion Falcon lead delivery integrations."""

from __future__ import annotations

import html
import re
from collections.abc import Sequence
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
    transcript_email_consent: bool

    @classmethod
    def from_payload(cls, payload: object) -> LeadCapture:
        """Build a consented lead from an RTVI event payload."""
        if not isinstance(payload, dict):
            raise ValueError("Lead details must be an object.")

        name = str(payload.get("name", "")).strip()
        email = str(payload.get("email", "")).strip().lower()
        recap_consent = payload.get("recapConsent") is True
        transcript_consent = payload.get("transcriptConsent") is True
        transcript_email_consent = payload.get("transcriptEmailConsent") is True
        if not name or len(name) > 120:
            raise ValueError("Enter a name of up to 120 characters.")
        if not EMAIL_PATTERN.fullmatch(email) or len(email) > 254:
            raise ValueError("Enter a valid email address.")
        if not recap_consent and not transcript_consent and not transcript_email_consent:
            raise ValueError("Choose at least one sharing option.")
        return cls(name, email, recap_consent, transcript_consent, transcript_email_consent)


@dataclass(frozen=True)
class DeliveryResult:
    """Destinations that completed or failed during a consented lead delivery."""

    completed_destinations: tuple[str, ...]
    failed_destinations: tuple[str, ...]
    failure_reasons: tuple[str, ...]


class LeadDelivery:
    """Sends opted-in lead data to HubSpot and Resend."""

    def __init__(
        self, *, hubspot_token: str, resend_api_key: str, email_from: str, calendly_url: str
    ):
        self._hubspot_token = hubspot_token
        self._resend_api_key = resend_api_key
        self._email_from = email_from
        self._calendly_url = calendly_url

    async def deliver(
        self, lead: LeadCapture, transcript: str = "", summary_notes: Sequence[str] = ()
    ) -> DeliveryResult:
        """Attempt each consented destination and report successes and failures."""
        timeout = aiohttp.ClientTimeout(total=10)
        completed_destinations = []
        failed_destinations = []
        failure_reasons = []
        async with aiohttp.ClientSession(timeout=timeout) as session:
            if lead.transcript_consent:
                if not transcript.strip():
                    failed_destinations.append("HubSpot")
                    failure_reasons.append("HubSpot transcript was empty.")
                else:
                    try:
                        contact_id = await self._upsert_contact(session, lead)
                        await self._create_note(session, contact_id, lead, transcript)
                    except (RuntimeError, aiohttp.ClientError, TimeoutError, ValueError) as error:
                        failed_destinations.append("HubSpot")
                        failure_reasons.append(self._failure_reason(error))
                    else:
                        completed_destinations.append("HubSpot")

            include_transcript = lead.transcript_email_consent and bool(transcript.strip())
            if lead.transcript_email_consent and not include_transcript:
                failed_destinations.append("Transcript email")
                failure_reasons.append(
                    "Transcript email was requested but no transcript was available."
                )

            if lead.recap_consent or include_transcript:
                try:
                    await self._send_email(
                        session,
                        lead,
                        transcript,
                        include_recap=lead.recap_consent,
                        include_transcript=include_transcript,
                        summary_notes=summary_notes,
                    )
                except (RuntimeError, aiohttp.ClientError, TimeoutError, ValueError) as error:
                    failed_destinations.append("Resend")
                    failure_reasons.append(self._failure_reason(error))
                else:
                    if lead.recap_consent:
                        completed_destinations.append("Resend")
                    if include_transcript:
                        completed_destinations.append("Transcript email")

        return DeliveryResult(
            tuple(completed_destinations),
            tuple(failed_destinations),
            tuple(failure_reasons),
        )

    @staticmethod
    def _failure_reason(error: Exception) -> str:
        if isinstance(error, RuntimeError):
            return str(error)
        return type(error).__name__

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
                raise RuntimeError(f"HubSpot contact delivery failed (HTTP {response.status}).")
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
                raise RuntimeError(f"HubSpot note delivery failed (HTTP {response.status}).")

    async def _send_email(
        self,
        session: aiohttp.ClientSession,
        lead: LeadCapture,
        transcript: str,
        *,
        include_recap: bool,
        include_transcript: bool,
        summary_notes: Sequence[str],
    ) -> None:
        content = []
        if include_recap:
            content.extend(
                [
                    f"<p>Thanks for speaking with Motion Falcon, {html.escape(lead.name)}.</p>",
                ]
            )
            normalized_notes = []
            for note in list(summary_notes)[:4]:
                if isinstance(note, str):
                    normalized_note = " ".join(note.split())[:160].strip()
                    if normalized_note:
                        normalized_notes.append(normalized_note)
            if normalized_notes:
                content.append("<h2>Conversation summary</h2><ul>")
                content.extend(f"<li>{html.escape(note)}</li>" for note in normalized_notes)
                content.append("</ul>")
            content.append(
                f'<p>Choose a time for a project conversation: <a href="{html.escape(self._calendly_url, quote=True)}">Book with Motion Falcon</a>.</p>'
            )
        if include_transcript:
            escaped_transcript = html.escape(transcript[:MAX_TRANSCRIPT_CHARS]).replace(
                "\n", "<br>"
            )
            content.extend(["<h2>Conversation transcript</h2>", f"<p>{escaped_transcript}</p>"])

        subject = "Your Motion Falcon project conversation"
        if include_transcript and not include_recap:
            subject = "Your Motion Falcon conversation transcript"
        elif include_transcript:
            subject = "Your Motion Falcon conversation and transcript"

        payload = {
            "from": self._email_from,
            "to": [lead.email],
            "subject": subject,
            "html": "".join(content),
        }
        headers = {"Authorization": f"Bearer {self._resend_api_key}"}
        async with session.post(
            "https://api.resend.com/emails", json=payload, headers=headers
        ) as response:
            if response.status >= 300:
                raise RuntimeError(f"Resend email delivery failed (HTTP {response.status}).")

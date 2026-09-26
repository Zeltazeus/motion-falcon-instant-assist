import asyncio

import pytest

from lead_capture import LeadCapture, LeadDelivery


class FakeResponse:
    def __init__(self, status, payload):
        self.status = status
        self.payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def json(self, content_type=None):
        return self.payload


class FakeSession:
    def __init__(self, statuses=None):
        self.statuses = statuses or {}
        self.requests = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def post(self, url, **kwargs):
        self.requests.append((url, kwargs))
        payload = {"results": [{"id": "contact-123"}]} if "contacts/batch/upsert" in url else {}
        return FakeResponse(self.statuses.get(url, 200), payload)


def run_delivery(monkeypatch, lead, transcript="", statuses=None, summary_notes=()):
    session = FakeSession(statuses)
    monkeypatch.setattr("lead_capture.aiohttp.ClientSession", lambda **_kwargs: session)
    delivery = LeadDelivery(
        hubspot_token="test-hubspot-token",
        resend_api_key="test-resend-key",
        email_from="Motion Falcon <test@example.com>",
        calendly_url="https://calendly.com/motion-falcon/test",
    )
    return asyncio.run(delivery.deliver(lead, transcript, summary_notes)), session


def test_valid_lead_with_recap_consent():
    lead = LeadCapture.from_payload(
        {
            "name": "Avery Jordan",
            "email": "AVERY@example.com",
            "recapConsent": True,
            "transcriptConsent": False,
        }
    )

    assert lead.email == "avery@example.com"
    assert lead.recap_consent is True
    assert lead.transcript_consent is False
    assert lead.transcript_email_consent is False


def test_lead_requires_at_least_one_explicit_consent():
    with pytest.raises(ValueError, match="sharing option"):
        LeadCapture.from_payload(
            {
                "name": "Avery Jordan",
                "email": "avery@example.com",
                "recapConsent": False,
                "transcriptConsent": False,
            }
        )


@pytest.mark.parametrize("email", ["", "not-an-email", "avery@example"])
def test_lead_rejects_invalid_email(email):
    with pytest.raises(ValueError, match="email"):
        LeadCapture.from_payload(
            {
                "name": "Avery Jordan",
                "email": email,
                "recapConsent": True,
                "transcriptConsent": False,
            }
        )


def test_recap_consent_sends_only_recap_through_resend(monkeypatch):
    lead = LeadCapture.from_payload(
        {"name": "Avery Jordan", "email": "avery@example.com", "recapConsent": True}
    )

    result, session = run_delivery(monkeypatch, lead, "Private conversation text")

    assert result.completed_destinations == ("Resend",)
    assert result.failed_destinations == ()
    assert [url for url, _request in session.requests] == ["https://api.resend.com/emails"]
    assert "Private conversation text" not in session.requests[0][1]["json"]["html"]


def test_recap_email_includes_escaped_summary_without_transcript(monkeypatch):
    lead = LeadCapture.from_payload(
        {"name": "Avery Jordan", "email": "avery@example.com", "recapConsent": True}
    )

    result, session = run_delivery(
        monkeypatch,
        lead,
        "Private transcript content",
        summary_notes=[
            "Needs <script>alert(1)</script>",
            "  Launch\nplanning  ",
            "Confirm scope",
            "Choose a date",
            "Ignored fifth",
        ],
    )

    assert result.completed_destinations == ("Resend",)
    email_html = session.requests[0][1]["json"]["html"]
    assert "<h2>Conversation summary</h2>" in email_html
    assert "Needs &lt;script&gt;alert(1)&lt;/script&gt;" in email_html
    assert "Launch planning" in email_html
    assert "Private transcript content" not in email_html
    assert "Ignored fifth" not in email_html


def test_transcript_storage_consent_only_uses_hubspot(monkeypatch):
    lead = LeadCapture.from_payload(
        {"name": "Avery Jordan", "email": "avery@example.com", "transcriptConsent": True}
    )

    result, session = run_delivery(monkeypatch, lead, "User: Hello")

    assert result.completed_destinations == ("HubSpot",)
    assert [url for url, _request in session.requests] == [
        "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert",
        "https://api.hubapi.com/crm/v3/objects/notes",
    ]
    assert "User: Hello" in session.requests[1][1]["json"]["properties"]["hs_note_body"]


def test_transcript_email_requires_explicit_consent(monkeypatch):
    lead = LeadCapture.from_payload(
        {
            "name": "Avery Jordan",
            "email": "avery@example.com",
            "transcriptEmailConsent": True,
        }
    )

    result, session = run_delivery(monkeypatch, lead, "User: <hello>\nAssistant: Welcome")

    assert result.completed_destinations == ("Transcript email",)
    assert [url for url, _request in session.requests] == ["https://api.resend.com/emails"]
    email = session.requests[0][1]["json"]
    assert email["subject"] == "Your Motion Falcon conversation transcript"
    assert "User: &lt;hello&gt;<br>Assistant: Welcome" in email["html"]


def test_recap_and_transcript_email_share_one_resend_message(monkeypatch):
    lead = LeadCapture.from_payload(
        {
            "name": "Avery Jordan",
            "email": "avery@example.com",
            "recapConsent": True,
            "transcriptEmailConsent": True,
        }
    )

    result, session = run_delivery(monkeypatch, lead, "User: Hello")

    assert result.completed_destinations == ("Resend", "Transcript email")
    assert len(session.requests) == 1
    assert "Choose a time" in session.requests[0][1]["json"]["html"]
    assert "User: Hello" in session.requests[0][1]["json"]["html"]


def test_provider_failures_do_not_block_other_selected_destinations(monkeypatch):
    lead = LeadCapture.from_payload(
        {
            "name": "Avery Jordan",
            "email": "avery@example.com",
            "recapConsent": True,
            "transcriptConsent": True,
        }
    )
    statuses = {
        "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert": 401,
        "https://api.resend.com/emails": 500,
    }

    result, session = run_delivery(monkeypatch, lead, "User: Hello", statuses)

    assert result.completed_destinations == ()
    assert result.failed_destinations == ("HubSpot", "Resend")
    assert [url for url, _request in session.requests] == [
        "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert",
        "https://api.resend.com/emails",
    ]


def test_transcript_email_fails_when_transcript_is_empty(monkeypatch):
    lead = LeadCapture.from_payload(
        {
            "name": "Avery Jordan",
            "email": "avery@example.com",
            "transcriptEmailConsent": True,
        }
    )

    result, session = run_delivery(monkeypatch, lead)

    assert result.completed_destinations == ()
    assert result.failed_destinations == ("Transcript email",)
    assert session.requests == []


def test_hubspot_transcript_consent_fails_when_transcript_is_empty(monkeypatch):
    lead = LeadCapture.from_payload(
        {"name": "Avery Jordan", "email": "avery@example.com", "transcriptConsent": True}
    )

    result, session = run_delivery(monkeypatch, lead)

    assert result.failed_destinations == ("HubSpot",)
    assert result.failure_reasons == ("HubSpot transcript was empty.",)
    assert session.requests == []


def test_non_success_resend_response_is_reported(monkeypatch):
    lead = LeadCapture.from_payload(
        {"name": "Avery Jordan", "email": "avery@example.com", "recapConsent": True}
    )

    result, _session = run_delivery(
        monkeypatch, lead, statuses={"https://api.resend.com/emails": 403}
    )

    assert result.failed_destinations == ("Resend",)
    assert result.failure_reasons == ("Resend email delivery failed (HTTP 403).",)

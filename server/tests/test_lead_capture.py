import pytest

from lead_capture import LeadCapture


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

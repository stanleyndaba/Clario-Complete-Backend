from datetime import datetime
from src.common.schemas import ClaimPacket, EvidenceItem, ClaimDetection, ValidationResult

def build_packet(claim: ClaimDetection, validation: ValidationResult, evidence_links: dict) -> ClaimPacket:
    """Build a claim packet from claim detection and validation data"""
    
    # Create narrative from claim and validation information
    narrative = (
        f"Claim Type: {claim.claim_type}. "
        f"Quantity affected: {claim.quantity_affected}. "
        f"Estimated amount: ${claim.amount_estimate:.2f}. "
        f"Evidence: {', '.join(validation.evidence_present)}. "
        f"Missing: {', '.join(validation.missing_evidence) or 'None'}."
    )
    
    # Convert evidence links to EvidenceItem objects
    evidence_items = [
        EvidenceItem(
            kind=k, 
            uri=v,
            captured_at=datetime.utcnow()  # Mock: would come from actual evidence metadata
        ) 
        for k, v in evidence_links.items()
    ]
    
    # Create line items for the claim
    line_items = [{
        "sku": claim.metadata.sku,
        "qty": claim.quantity_affected,
        "amount": claim.amount_estimate
    }]
    
    return ClaimPacket(
        claim_id=claim.claim_id,
        claim_type=claim.claim_type,
        narrative=narrative,
        line_items=line_items,
        amount_requested=claim.amount_estimate,
        evidence=evidence_items,
        attachments_manifest={k: v for k, v in evidence_links.items()},
        metadata=claim.metadata,
        built_at=datetime.utcnow()
    )









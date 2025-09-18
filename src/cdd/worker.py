"""
Background worker for claim validation processing
"""

def enqueue_validation(claim_id: str):
    """
    Enqueue a claim for validation processing
    This is a stub implementation for the missing worker module
    """
    # In a real implementation, this would add the claim to a job queue
    # for background processing by validation workers
    print(f"Enqueuing claim {claim_id} for validation")
    return True


"""
Active learning sampler for uncertain samples.
"""
import numpy as np

def sample_uncertain_instances(model, unlabeled_data, n_samples=10):
    """Sample instances with highest uncertainty for labeling."""
    # TODO: Implement uncertainty sampling
    return unlabeled_data.sample(n_samples) 
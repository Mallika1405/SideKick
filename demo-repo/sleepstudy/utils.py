import numpy as np

def set_seed(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)

def clip_series(s, low, high):
    return s.clip(lower=low, upper=high)

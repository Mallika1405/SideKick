import numpy as np
from scipy import stats

def bootstrap_mean_ci(x, rng, n=2000):
    means = [rng.choice(x, len(x)).mean() for _ in range(n)]
    return np.percentile(means, [2.5, 97.5])

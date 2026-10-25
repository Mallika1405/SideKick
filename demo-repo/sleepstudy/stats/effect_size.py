import numpy as np
from scipy import stats

def cohens_d(a, b):
    pooled = ((a.var() + b.var()) / 2) ** 0.5
    return (a.mean() - b.mean()) / pooled

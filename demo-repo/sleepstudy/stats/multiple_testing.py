import numpy as np
from scipy import stats

def bonferroni(pvalues):
    m = len(pvalues)
    return [min(1.0, p * m) for p in pvalues]

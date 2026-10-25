import numpy as np
from scipy import stats

def anova_by_bin(df):
    groups = [g.exam_score.values for _, g in df.groupby('sleep_bin', observed=True)]
    return stats.f_oneway(*groups)

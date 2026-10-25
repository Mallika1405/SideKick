import numpy as np
from scipy import stats

def short_vs_normal(df):
    a = df[df.sleep_bin == 'short'].exam_score
    b = df[df.sleep_bin == 'normal'].exam_score
    return stats.ttest_ind(a, b, equal_var=False)

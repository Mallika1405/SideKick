import numpy as np
from scipy import stats

def sleep_exam_corr(df):
    return stats.pearsonr(df.sleep_hours, df.exam_score)

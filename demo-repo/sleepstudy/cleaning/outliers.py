import pandas as pd
from sleepstudy.config import CONFIG

def outliers(df: pd.DataFrame) -> pd.DataFrame:
    """Drop exam-score outliers by z-score."""
    z = (df.exam_score - df.exam_score.mean()) / df.exam_score.std()
    return df[z.abs() < CONFIG.outlier_z]

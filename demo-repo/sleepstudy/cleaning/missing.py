import pandas as pd
from sleepstudy.config import CONFIG

def missing(df: pd.DataFrame) -> pd.DataFrame:
    """Impute missing GPA with the median."""
    df['gpa'] = df['gpa'].fillna(df['gpa'].median())
    return df.dropna(subset=['exam_score','sleep_hours'])

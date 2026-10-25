import pandas as pd

def add_study_load(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['study_load'] = df.study_hours / df.course_count.clip(lower=1)
    return df

import pandas as pd

def add_stress_index(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['stress_index'] = df.stress_score * df.course_count
    return df

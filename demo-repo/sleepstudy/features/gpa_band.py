import pandas as pd

def add_gpa_band(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['gpa_band'] = pd.qcut(df.gpa, 4, labels=False, duplicates='drop')
    return df

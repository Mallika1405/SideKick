import pandas as pd

def add_caffeine_level(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['caffeine_level'] = (df.caffeine_mg / 100).round(1)
    return df

import pandas as pd

def add_sleep_debt(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['sleep_debt'] = (8 - df.sleep_hours).clip(lower=0)
    return df

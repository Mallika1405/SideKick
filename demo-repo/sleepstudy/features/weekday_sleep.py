import pandas as pd

def add_weekday_sleep(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['weekend_gap'] = df.weekend_sleep - df.weeknight_sleep
    return df

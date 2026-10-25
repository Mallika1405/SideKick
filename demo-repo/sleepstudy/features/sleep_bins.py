import pandas as pd

def add_sleep_bins(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['sleep_bin'] = pd.cut(df.sleep_hours, [0, 5, 7, 9, 24], labels=['short','low','normal','long'])
    return df

import pandas as pd
from sleepstudy.config import CONFIG

def categories(df: pd.DataFrame) -> pd.DataFrame:
    """Standardise categorical labels."""
    df['major'] = df['major'].str.strip().str.title()
    return df

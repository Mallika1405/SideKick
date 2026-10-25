import pandas as pd
from sleepstudy.config import CONFIG

def dates(df: pd.DataFrame) -> pd.DataFrame:
    """Parse submission timestamps."""
    df['submitted_at'] = pd.to_datetime(df['submitted_at'], errors='coerce')
    return df

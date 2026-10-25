import pandas as pd
from sleepstudy.config import CONFIG

def pii(df: pd.DataFrame) -> pd.DataFrame:
    """Remove personally identifying columns."""
    return df.drop(columns=[c for c in ['name','email'] if c in df.columns])

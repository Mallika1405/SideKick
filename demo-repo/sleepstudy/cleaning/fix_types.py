import pandas as pd
from sleepstudy.config import CONFIG

def fix_types(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce numeric columns."""
    for c in ['sleep_hours','exam_score','gpa']:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    return df

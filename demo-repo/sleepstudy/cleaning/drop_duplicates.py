import pandas as pd
from sleepstudy.config import CONFIG

def drop_duplicates(df: pd.DataFrame) -> pd.DataFrame:
    """Drop repeated student rows, keeping the latest."""
    return df.sort_values('submitted_at').drop_duplicates('student_id', keep='last')

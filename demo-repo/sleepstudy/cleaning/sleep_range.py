import pandas as pd
from sleepstudy.config import CONFIG

def sleep_range(df: pd.DataFrame) -> pd.DataFrame:
    """Remove impossible sleep durations."""
    return df[df.sleep_hours.between(CONFIG.min_sleep_hours, CONFIG.max_sleep_hours)]

import pandas as pd

def load_grades(path: str) -> pd.DataFrame:
    """Load exam grades from CSV and normalise column names."""
    df = pd.read_csv(path)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    return df

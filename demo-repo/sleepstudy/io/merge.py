import pandas as pd

def merge_sources(survey, grades, wearable) -> pd.DataFrame:
    """Join survey, grades and wearable data on student_id."""
    df = survey.merge(grades, on="student_id", how="inner")
    return df.merge(wearable, on="student_id", how="left")

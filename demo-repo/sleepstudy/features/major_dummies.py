import pandas as pd

def add_major_dummies(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df = pd.concat([df, pd.get_dummies(df.major, prefix='major')], axis=1)
    return df

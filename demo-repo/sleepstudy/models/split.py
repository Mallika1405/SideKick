import pandas as pd
from sklearn.model_selection import train_test_split
from sleepstudy.config import CONFIG
from sleepstudy.features.build import FEATURE_COLUMNS
from sleepstudy.models.scaling import fit_scaler

def split_data(df):
    """split into train and test sets."""
    X, y = df[FEATURE_COLUMNS], df[CONFIG.target]
    return train_test_split(X, y, test_size=CONFIG.test_fraction, random_state=CONFIG.random_seed)

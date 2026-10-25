from sklearn.model_selection import train_test_split
from sleepstudy.config import CONFIG
from sleepstudy.features.build import FEATURE_COLUMNS

def split_data(df):
    """Split into train and test sets before any fitting or scaling."""
    X, y = df[FEATURE_COLUMNS], df[CONFIG.target]
    return train_test_split(X, y, test_size=CONFIG.test_fraction, random_state=CONFIG.random_seed)

from sklearn.preprocessing import StandardScaler

def fit_scaler(X):
    """Fit a standard scaler on the given data."""
    return StandardScaler().fit(X)

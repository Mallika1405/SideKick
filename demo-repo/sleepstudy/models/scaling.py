from sklearn.preprocessing import StandardScaler

def fit_scaler(X_train):
    """Fit the scaler on training data only."""
    return StandardScaler().fit(X_train)

from sklearn.linear_model import RidgeCV

def fit_ridge(X_train, y_train):
    return RidgeCV(alphas=[0.1, 1.0, 10.0]).fit(X_train, y_train)
